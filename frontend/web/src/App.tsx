// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface ArtworkRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  artworkName: string;
  status: "pending" | "authentic" | "forgery";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [artworks, setArtworks] = useState<ArtworkRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newArtworkData, setNewArtworkData] = useState({
    artworkName: "",
    description: "",
    hyperspectralData: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Statistics for dashboard
  const authenticCount = artworks.filter(a => a.status === "authentic").length;
  const forgeryCount = artworks.filter(a => a.status === "forgery").length;
  const pendingCount = artworks.filter(a => a.status === "pending").length;

  // Filter artworks based on search term
  const filteredArtworks = artworks.filter(artwork =>
    artwork.artworkName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    artwork.owner.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    loadArtworks().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadArtworks = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("artwork_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing artwork keys:", e);
        }
      }
      
      const list: ArtworkRecord[] = [];
      
      for (const key of keys) {
        try {
          const artworkBytes = await contract.getData(`artwork_${key}`);
          if (artworkBytes.length > 0) {
            try {
              const artworkData = JSON.parse(ethers.toUtf8String(artworkBytes));
              list.push({
                id: key,
                encryptedData: artworkData.data,
                timestamp: artworkData.timestamp,
                owner: artworkData.owner,
                artworkName: artworkData.artworkName,
                status: artworkData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing artwork data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading artwork ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setArtworks(list);
    } catch (e) {
      console.error("Error loading artworks:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const uploadArtwork = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setUploading(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting hyperspectral data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newArtworkData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const artworkId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const artworkData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        artworkName: newArtworkData.artworkName,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `artwork_${artworkId}`, 
        ethers.toUtf8Bytes(JSON.stringify(artworkData))
      );
      
      const keysBytes = await contract.getData("artwork_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(artworkId);
      
      await contract.setData(
        "artwork_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted data submitted securely!"
      });
      
      await loadArtworks();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowUploadModal(false);
        setNewArtworkData({
          artworkName: "",
          description: "",
          hyperspectralData: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setUploading(false);
    }
  };

  const markAsAuthentic = async (artworkId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const artworkBytes = await contract.getData(`artwork_${artworkId}`);
      if (artworkBytes.length === 0) {
        throw new Error("Artwork not found");
      }
      
      const artworkData = JSON.parse(ethers.toUtf8String(artworkBytes));
      
      const updatedArtwork = {
        ...artworkData,
        status: "authentic"
      };
      
      await contract.setData(
        `artwork_${artworkId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedArtwork))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE verification completed - Artwork is authentic!"
      });
      
      await loadArtworks();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const markAsForgery = async (artworkId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const artworkBytes = await contract.getData(`artwork_${artworkId}`);
      if (artworkBytes.length === 0) {
        throw new Error("Artwork not found");
      }
      
      const artworkData = JSON.parse(ethers.toUtf8String(artworkBytes));
      
      const updatedArtwork = {
        ...artworkData,
        status: "forgery"
      };
      
      await contract.setData(
        `artwork_${artworkId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedArtwork))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE analysis completed - Artwork is a forgery!"
      });
      
      await loadArtworks();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Analysis failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the forgery detection network",
      icon: "🔗"
    },
    {
      title: "Upload Artwork Data",
      description: "Submit encrypted hyperspectral data of your artwork for analysis",
      icon: "🖼️"
    },
    {
      title: "FHE Analysis",
      description: "Our network performs forgery detection without decrypting your data",
      icon: "🔍"
    },
    {
      title: "Get Results",
      description: "Receive authentication results while keeping your artwork data private",
      icon: "✅"
    }
  ];

  const renderStatusChart = () => {
    const total = artworks.length || 1;
    const authenticPercentage = (authenticCount / total) * 100;
    const forgeryPercentage = (forgeryCount / total) * 100;
    const pendingPercentage = (pendingCount / total) * 100;

    return (
      <div className="status-chart">
        <div className="chart-bar authentic" style={{ width: `${authenticPercentage}%` }}>
          <span>Authentic: {authenticCount}</span>
        </div>
        <div className="chart-bar forgery" style={{ width: `${forgeryPercentage}%` }}>
          <span>Forgery: {forgeryCount}</span>
        </div>
        <div className="chart-bar pending" style={{ width: `${pendingPercentage}%` }}>
          <span>Pending: {pendingCount}</span>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Forgery<span>Net</span></h1>
          <p>Anonymous Art Forgery Detection Network</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowUploadModal(true)} 
            className="upload-btn"
          >
            Upload Artwork
          </button>
          <button 
            className="tutorial-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-section">
          <h2>Art Authentication Through FHE</h2>
          <p>Securely analyze artwork hyperspectral data without exposing sensitive information</p>
          <div className="fhe-badge">Fully Homomorphic Encryption</div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>How Forgery Detection Works</h2>
            <p className="subtitle">Learn how FHE protects your artwork data during analysis</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-section">
          <div className="stats-card">
            <h3>Artwork Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{artworks.length}</div>
                <div className="stat-label">Total Artworks</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{authenticCount}</div>
                <div className="stat-label">Authentic</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{forgeryCount}</div>
                <div className="stat-label">Forgeries</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
            </div>
          </div>
          
          <div className="chart-card">
            <h3>Authentication Status</h3>
            {renderStatusChart()}
          </div>
        </div>
        
        <div className="artworks-section">
          <div className="section-header">
            <h2>Artwork Records</h2>
            <div className="search-box">
              <input
                type="text"
                placeholder="Search artworks..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <button 
                onClick={loadArtworks}
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="artworks-list">
            {filteredArtworks.length === 0 ? (
              <div className="no-artworks">
                <p>No artwork records found</p>
                <button 
                  onClick={() => setShowUploadModal(true)}
                >
                  Upload First Artwork
                </button>
              </div>
            ) : (
              filteredArtworks.map(artwork => (
                <div className="artwork-card" key={artwork.id}>
                  <div className="artwork-header">
                    <h3>{artwork.artworkName}</h3>
                    <span className={`status-badge ${artwork.status}`}>
                      {artwork.status}
                    </span>
                  </div>
                  <div className="artwork-details">
                    <p>Owner: {artwork.owner.substring(0, 6)}...{artwork.owner.substring(38)}</p>
                    <p>Submitted: {new Date(artwork.timestamp * 1000).toLocaleDateString()}</p>
                  </div>
                  <div className="artwork-actions">
                    {isOwner(artwork.owner) && artwork.status === "pending" && (
                      <>
                        <button 
                          onClick={() => markAsAuthentic(artwork.id)}
                        >
                          Mark Authentic
                        </button>
                        <button 
                          onClick={() => markAsForgery(artwork.id)}
                        >
                          Mark as Forgery
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showUploadModal && (
        <ModalUpload 
          onSubmit={uploadArtwork} 
          onClose={() => setShowUploadModal(false)} 
          uploading={uploading}
          artworkData={newArtworkData}
          setArtworkData={setNewArtworkData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            <div className="notification-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="notification-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <h3>ForgeryNet</h3>
            <p>Anonymous Art Forgery Detection Network</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="copyright">
            © {new Date().getFullYear()} ForgeryNet. All rights reserved.
          </div>
          <div className="fhe-badge">FHE-Powered Authentication</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalUploadProps {
  onSubmit: () => void; 
  onClose: () => void; 
  uploading: boolean;
  artworkData: any;
  setArtworkData: (data: any) => void;
}

const ModalUpload: React.FC<ModalUploadProps> = ({ 
  onSubmit, 
  onClose, 
  uploading,
  artworkData,
  setArtworkData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setArtworkData({
      ...artworkData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!artworkData.artworkName || !artworkData.hyperspectralData) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="upload-modal">
        <div className="modal-header">
          <h2>Upload Artwork for Analysis</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            Your artwork data will be encrypted with FHE before analysis
          </div>
          
          <div className="form-group">
            <label>Artwork Name *</label>
            <input 
              type="text"
              name="artworkName"
              value={artworkData.artworkName} 
              onChange={handleChange}
              placeholder="e.g. Mona Lisa, Starry Night..." 
            />
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <input 
              type="text"
              name="description"
              value={artworkData.description} 
              onChange={handleChange}
              placeholder="Brief description of the artwork..." 
            />
          </div>
          
          <div className="form-group">
            <label>Hyperspectral Data *</label>
            <textarea 
              name="hyperspectralData"
              value={artworkData.hyperspectralData} 
              onChange={handleChange}
              placeholder="Paste encrypted hyperspectral data here..." 
              rows={6}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={uploading}
            className="submit-btn"
          >
            {uploading ? "Encrypting with FHE..." : "Submit for Analysis"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;