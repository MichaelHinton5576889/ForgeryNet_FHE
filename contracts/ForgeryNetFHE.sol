// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/*
  Notes:
  - This file is intended for use in a consortium setting.
  - Keep build toolchains and FHE library versions aligned across participants.
  - Be mindful of gas implications when storing large encrypted artifacts on-chain.
  - Auditing cryptographic callbacks and proof verification logic is essential.
*/

contract ForgeryNetFHE is SepoliaConfig {
    // Lightweight descriptor for an uploaded encrypted artwork sample.
    struct EncryptedArtwork {
        uint256 id;
        euint64 encryptedFingerprint; // Encrypted compact fingerprint
        euint64 encryptedMeta;        // Encrypted metadata blob (compact)
        uint256 uploadedAt;
    }

    // Holder for per-party encrypted model share or encrypted vote
    struct EncryptedModelShare {
        uint256 artworkId;
        address submitter;
        euint32 encryptedDecision;  // encrypted class or score (compact)
        uint256 submittedAt;
    }

    // Result container after aggregation (revealed to authorized party)
    struct AggregatedResult {
        uint256 artworkId;
        string verdict;       // Plaintext result after authorized reveal
        uint32 confidence;    // Plaintext confidence score
        bool revealed;
    }

    uint256 public artworkCounter;
    mapping(uint256 => EncryptedArtwork) public artworks;

    uint256 public shareCounter;
    mapping(uint256 => EncryptedModelShare) public modelShares;
    mapping(uint256 => uint256[]) private sharesByArtwork;

    mapping(uint256 => AggregatedResult) public results;

    // Encrypted aggregate counters per artwork stored as euint32
    mapping(uint256 => euint32) private encryptedAggregates;

    // Tracks ongoing decryption requests to internal identifiers
    mapping(uint256 => uint256) private decryptionRequestToArtwork;

    // Events for off-chain monitoring and indexing
    event ArtworkUploaded(uint256 indexed artworkId, uint256 timestamp);
    event ModelShareSubmitted(uint256 indexed shareId, uint256 artworkId, address indexed submitter);
    event AggregateDecryptionRequested(uint256 indexed artworkId, uint256 requestId);
    event AggregateDecrypted(uint256 indexed artworkId, string verdict, uint32 confidence);

    // Modifier placeholder for access constraints
    modifier onlyConsortium() {
        // Implement consortium membership check off-chain or via governance contract.
        _;
    }

    // Constructor left intentionally minimal.
    constructor() {}

    /*
      Implementation notes:
      - Storage uses compact encrypted primitives where possible to reduce on-chain footprint.
      - Callbacks must verify FHE proofs to maintain end-to-end integrity.
      - The contract avoids storing raw plaintext except after authorised reveal.
    */

    /// @dev Submit a new encrypted artwork fingerprint and compact metadata.
    function uploadEncryptedArtwork(
        euint64 encryptedFingerprint,
        euint64 encryptedMeta
    ) public onlyConsortium returns (uint256) {
        artworkCounter += 1;
        uint256 id = artworkCounter;

        artworks[id] = EncryptedArtwork({
            id: id,
            encryptedFingerprint: encryptedFingerprint,
            encryptedMeta: encryptedMeta,
            uploadedAt: block.timestamp
        });

        emit ArtworkUploaded(id, block.timestamp);
        return id;
    }

    /// @dev Submit an encrypted model share or encrypted local decision for a given artwork.
    function submitEncryptedModelShare(
        uint256 artworkId,
        euint32 encryptedDecision
    ) public returns (uint256) {
        require(artworkId > 0 && artworkId <= artworkCounter, "Invalid artwork");

        shareCounter += 1;
        uint256 sid = shareCounter;

        modelShares[sid] = EncryptedModelShare({
            artworkId: artworkId,
            submitter: msg.sender,
            encryptedDecision: encryptedDecision,
            submittedAt: block.timestamp
        });

        sharesByArtwork[artworkId].push(sid);

        // If aggregate accumulator not initialized, set to zero
        if (!FHE.isInitialized(encryptedAggregates[artworkId])) {
            encryptedAggregates[artworkId] = FHE.asEuint32(0);
        }

        // Homomorphically add the new encrypted decision to the aggregate
        encryptedAggregates[artworkId] = FHE.add(
            encryptedAggregates[artworkId],
            encryptedDecision
        );

        emit ModelShareSubmitted(sid, artworkId, msg.sender);
        return sid;
    }

    /// @dev Request decryption of the aggregated result for an artwork.
    function requestAggregatedResultDecryption(uint256 artworkId) public onlyConsortium {
        require(FHE.isInitialized(encryptedAggregates[artworkId]), "No aggregate");
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(encryptedAggregates[artworkId]);

        // Request decryption and register linkage to the artwork id
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.onAggregatesDecrypted.selector);
        decryptionRequestToArtwork[reqId] = artworkId;

        emit AggregateDecryptionRequested(artworkId, reqId);
    }

    /// @dev Callback invoked by FHE runtime when decryption completes.
    function onAggregatesDecrypted(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        // Map request back to artwork
        uint256 artworkId = decryptionRequestToArtwork[requestId];
        require(artworkId != 0, "Unknown request");

        // Proof verification is mandatory to ensure the integrity of the cleartexts.
        FHE.checkSignatures(requestId, cleartexts, proof);

        // Decode the decrypted aggregate value as a uint32
        uint32 aggregateValue = abi.decode(cleartexts, (uint32));

        // Tentative plaintext post-processing: derive a verdict and a confidence score.
        // Keep logic intentionally simple — real deployments should use audited policies.
        string memory verdict = aggregateValue > 0 ? "likely_forgery" : "likely_authentic";
        uint32 confidence = computeConfidence(aggregateValue);

        results[artworkId] = AggregatedResult({
            artworkId: artworkId,
            verdict: verdict,
            confidence: confidence,
            revealed: true
        });

        emit AggregateDecrypted(artworkId, verdict, confidence);
    }

    /// @dev Retrieve raw encrypted aggregate for an artwork.
    function getEncryptedAggregate(uint256 artworkId) public view returns (euint32) {
        return encryptedAggregates[artworkId];
    }

    /// @dev Helper to fetch submitted share ids for an artwork.
    function listSharesForArtwork(uint256 artworkId) public view returns (uint256[] memory) {
        return sharesByArtwork[artworkId];
    }

    /// @dev Obtain the decrypted aggregated result after reveal.
    function getAggregatedResult(uint256 artworkId) public view returns (
        bool revealed,
        string memory verdict,
        uint32 confidence
    ) {
        AggregatedResult storage r = results[artworkId];
        return (r.revealed, r.verdict, r.confidence);
    }

    /// @dev Utility to compute a simple confidence metric from aggregated integer.
    function computeConfidence(uint32 aggregated) internal pure returns (uint32) {
        // A compact heuristic: saturate confidence at 100.
        uint32 value = aggregated;
        if (value > 100) {
            return 100;
        }
        return value;
    }

    /// @dev Convert bytes32 to uint256 safely.
    function bytes32ToUint(bytes32 b) internal pure returns (uint256) {
        return uint256(b);
    }

    /// @dev Remove stored model shares for a given artwork (consortium-only cleanup).
    function pruneShares(uint256 artworkId) public onlyConsortium {
        uint256[] storage ids = sharesByArtwork[artworkId];
        for (uint i = 0; i < ids.length; i++) {
            delete modelShares[ids[i]];
        }
        delete sharesByArtwork[artworkId];
        // Note: encrypted aggregate is intentionally preserved for auditability.
    }

    /*
      Final remarks:
      - This contract contains minimal access control placeholders.
      - Production usage requires a governance layer, rate limits, and economic incentives.
      - Keep any plaintext reveals strictly limited and auditable.
    */
}
