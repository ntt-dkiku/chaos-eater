import React, { useState, useEffect, useRef } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Upload,
  Send,
  Square,
  Play,
  Download,
  Trash2,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle,
  Info,
  Eye,
  EyeOff,
  Loader,
  Menu,
  X,
  Paperclip,
  PanelLeftOpen,
  PanelLeftClose
} from 'lucide-react';

export default function ChaosEaterApp() {
  // State management
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [sidebarCollapsed, setSidebarCollapsed] = useState({
    general: false,
    usage: true,
    cycles: true
  });
  
  const [formData, setFormData] = useState({
    model: 'openai/gpt-4o-2024-08-06',
    apiKey: '',
    apiKeyVisible: false,
    cluster: '',
    projectName: 'chaos-project',
    instructions: '',
    cleanBefore: true,
    cleanAfter: true,
    newDeployment: true,
    temperature: 0.0,
    seed: 42,
    maxSteadyStates: 3,
    maxRetries: 3,
  });
  
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [notification, setNotification] = useState(null);
  const [hoveredExample, setHoveredExample] = useState(null);
  const fileInputRef = useRef(null);
  const logoRef = useRef(null);

  const models = [
    'openai/gpt-4o-2024-08-06',
    'google/gemini-1.5-pro-latest',
    'anthropic/claude-3-5-sonnet-20241022',
    'ollama/qwen3:32b',
    'custom'
  ];

  // Mouse tracking for eyes
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (logoRef.current) {
        const rect = logoRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
        const distance = Math.min(8, Math.hypot(e.clientX - centerX, e.clientY - centerY) / 20);
        
        setMousePosition({
          x: Math.cos(angle) * distance,
          y: Math.sin(angle) * distance
        });
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Handle sidebar resize
  const startResizing = React.useCallback(() => {
    setIsResizing(true);
  }, []);

  const stopResizing = React.useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = React.useCallback((e) => {
    if (isResizing) {
      const newWidth = e.clientX;
      if (newWidth >= 280 && newWidth <= 600) {
        setSidebarWidth(newWidth);
      }
    }
  }, [isResizing]);

  useEffect(() => {
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [resize, stopResizing]);

  // Styles
  const styles = {
    exampleCard: (isHovered) => ({
      padding: '24px',
      backgroundColor: isHovered ? '#2a2a2a' : '#1f1f1f',
      borderRadius: '8px',
      border: `1px solid ${isHovered ? '#84cc16' : '#374151'}`,
      transition: 'all 0.3s ease',
      transform: isHovered ? 'translateY(-4px)' : 'translateY(0)',
      boxShadow: isHovered ? '0 10px 30px rgba(132, 204, 22, 0.2)' : 'none',
      cursor: 'pointer',
      textAlign: 'center'
    }),
    exampleTitle: (isHovered) => ({
      fontSize: '14px',
      fontWeight: '500',
      marginBottom: '8px',
      color: isHovered ? '#84cc16' : '#ffffff',
      transition: 'color 0.3s ease'
    }),
    exampleDesc: (isHovered) => ({
      fontSize: '12px',
      color: isHovered ? '#d1d5db' : '#9ca3af',
      transition: 'color 0.3s ease'
    })
  };

  const handleFileUpload = (event) => {
    const files = Array.from(event.target.files);
    const filePromises = files.map(file => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          resolve({
            name: file.name,
            content: e.target.result,
            size: file.size
          });
        };
        reader.readAsText(file);
      });
    });
    
    Promise.all(filePromises).then(results => {
      setUploadedFiles(prev => [...prev, ...results]);
    });
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files);
    const fileEvent = { target: { files } };
    handleFileUpload(fileEvent);
  };

  const loadExample = (exampleType) => {
    const examples = {
      nginx: {
        files: [{
          name: 'nginx-deployment.yaml',
          content: `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: nginx\nspec:\n  replicas: 3`
        }],
        instructions: '- The Chaos-Engineering experiment must be completed within 1 minute.\n- List ONLY one steady state about Pod Count.\n- Conduct pod-kill'
      },
      nginxLimited: {
        files: [{
          name: 'nginx-deployment.yaml',
          content: `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: nginx\nspec:\n  replicas: 3`
        }],
        instructions: 'The Chaos-Engineering experiment must be completed within 1 minute.'
      },
      sockshop: {
        files: [{
          name: 'sock-shop.yaml',
          content: '# Sock Shop microservices deployment'
        }],
        instructions: '- The Chaos-Engineering experiment must be completed within 1 minute.\n- Test with URL: http://front-end.sock-shop.svc.cluster.local/'
      }
    };
    
    const example = examples[exampleType];
    if (example) {
      setUploadedFiles(example.files);
      setFormData(prev => ({ ...prev, instructions: example.instructions }));
    }
  };

  const handleSubmit = async () => {
    if (uploadedFiles.length === 0 && !formData.instructions) {
      setNotification({ type: 'error', message: 'Please upload files or provide instructions' });
      return;
    }
    
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      setNotification({ type: 'success', message: 'Chaos experiment started successfully!' });
    }, 2000);
  };

  const [uploadHovered, setUploadHovered] = useState(false);
  const [logoHovered, setLogoHovered] = useState(false);
  const [buttonHovered, setButtonHovered] = useState({});

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: '#0a0a0a', color: '#e5e7eb', position: 'relative' }}>
      {/* Sidebar */}
      <div style={{ 
        width: sidebarOpen ? `${sidebarWidth}px` : '0px',
        minWidth: sidebarOpen ? `${sidebarWidth}px` : '0px',
        backgroundColor: '#111111', 
        borderRight: sidebarOpen ? '1px solid #374151' : 'none',
        overflowY: 'auto',
        overflowX: 'hidden',
        transition: isResizing ? 'none' : 'all 0.3s ease',
        position: 'relative'
      }}>
        <div style={{ 
          width: `${sidebarWidth}px`,
          opacity: sidebarOpen ? 1 : 0,
          transition: 'opacity 0.3s ease',
          pointerEvents: sidebarOpen ? 'auto' : 'none'
        }}>
          {/* Logo with Close Button */}
          <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #374151' }}>
            <img src="/chaoseater_logo.png" style={{ width: 'auto', height: '52px'}} />
            {/* <span style={{ fontSize: '20px', fontWeight: '600', fontVariant: 'small-caps' }}>ChaosEater</span> */}

            <button
              aria-label="Close sidebar"
              onClick={() => setSidebarOpen(false)}
              title="Close sidebar"
              style={{
                marginLeft: 'auto',
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: '#1f1f1f',
                border: '1px solid #374151',
                color: '#d1d5db',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease',
                boxShadow: '0 4px 12px rgba(0,0,0,0.25)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#2a2a2a';
                e.currentTarget.style.color = '#84cc16';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#1f1f1f';
                e.currentTarget.style.color = '#d1d5db';
              }}
            >
              <PanelLeftClose size={16} />
            </button>
          </div>

        {/* General Settings */}
        <div style={{ borderBottom: '1px solid #374151' }}>
          <button
            onClick={() => setSidebarCollapsed(prev => ({ ...prev, general: !prev.general }))}
            style={{ width: '100%', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'transparent', border: 'none', color: '#e5e7eb', cursor: 'pointer' }}
          >
            <span style={{ fontSize: '14px', fontWeight: '500' }}>General settings</span>
            {sidebarCollapsed.general ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
          
          {!sidebarCollapsed.general && (
            <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Model Selection */}
              <div>
                <label style={{ fontSize: '12px', color: '#6b7280', fontWeight: '400', letterSpacing: '0.5px' }}>Model</label>
                <select 
                  style={{ 
                    width: '100%', 
                    marginTop: '4px', 
                    padding: '10px 12px', 
                    backgroundColor: '#0a0a0a', 
                    borderRadius: '4px', 
                    border: '1px solid #1f2937', 
                    color: '#e5e7eb',
                    fontSize: '14px',
                    outline: 'none',
                    cursor: 'pointer',
                    appearance: 'none',
                    backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 8px center',
                    backgroundSize: '20px',
                    paddingRight: '36px',
                    transition: 'border-color 0.2s ease'
                  }}
                  value={formData.model}
                  onChange={(e) => setFormData({...formData, model: e.target.value})}
                  onFocus={(e) => e.target.style.borderColor = '#374151'}
                  onBlur={(e) => e.target.style.borderColor = '#1f2937'}
                >
                  {models.map(model => (
                    <option key={model} value={model} style={{ backgroundColor: '#0a0a0a', padding: '8px' }}>{model}</option>
                  ))}
                </select>
              </div>
              
              {/* API Key */}
              <div>
                <label style={{ fontSize: '12px', color: '#6b7280', fontWeight: '400', letterSpacing: '0.5px' }}>API key</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={formData.apiKeyVisible ? "text" : "password"}
                    placeholder="Enter your API key"
                    style={{ 
                      width: '100%', 
                      marginTop: '4px', 
                      padding: '10px 36px 10px 12px', 
                      backgroundColor: '#0a0a0a', 
                      borderRadius: '4px', 
                      border: '1px solid #1f2937', 
                      color: '#e5e7eb', 
                      fontSize: '14px',
                      outline: 'none',
                      transition: 'border-color 0.2s ease'
                    }}
                    value={formData.apiKey}
                    onChange={(e) => setFormData({...formData, apiKey: e.target.value})}
                    onFocus={(e) => e.target.style.borderColor = '#374151'}
                    onBlur={(e) => e.target.style.borderColor = '#1f2937'}
                  />
                  <button
                    onClick={() => setFormData({...formData, apiKeyVisible: !formData.apiKeyVisible})}
                    style={{ 
                      position: 'absolute', 
                      right: '8px', 
                      top: '50%', 
                      transform: 'translateY(-50%)', 
                      backgroundColor: 'transparent', 
                      border: 'none', 
                      color: '#6b7280', 
                      cursor: 'pointer',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.color = '#9ca3af'}
                    onMouseLeave={(e) => e.currentTarget.style.color = '#6b7280'}
                  >
                    {formData.apiKeyVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              
              {/* Cluster Selection */}
              <div>
                <label style={{ fontSize: '12px', color: '#6b7280', fontWeight: '400', letterSpacing: '0.5px' }}>Cluster selection</label>
                <select 
                  style={{ 
                    width: '100%', 
                    marginTop: '4px', 
                    padding: '10px 12px', 
                    backgroundColor: '#0a0a0a', 
                    borderRadius: '4px', 
                    border: '1px solid #1f2937', 
                    color: formData.cluster ? '#e5e7eb' : '#6b7280',
                    fontSize: '14px',
                    outline: 'none',
                    cursor: 'pointer',
                    appearance: 'none',
                    backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 8px center',
                    backgroundSize: '20px',
                    paddingRight: '36px',
                    transition: 'border-color 0.2s ease'
                  }}
                  value={formData.cluster}
                  onChange={(e) => setFormData({...formData, cluster: e.target.value})}
                  onFocus={(e) => e.target.style.borderColor = '#374151'}
                  onBlur={(e) => e.target.style.borderColor = '#1f2937'}
                >
                  <option value="" style={{ backgroundColor: '#0a0a0a' }}>No clusters available right now. Please wait...</option>
                </select>
              </div>
              
              <button 
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  backgroundColor: 'transparent',
                  color: '#9ca3af',
                  border: '1px solid #1f2937',
                  borderRadius: '4px',
                  fontSize: '14px',
                  fontWeight: '400',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  ...(buttonHovered.clean ? { 
                    borderColor: '#374151', 
                    color: '#e5e7eb',
                    transform: 'translateY(-1px)'
                  } : {})
                }}
                onMouseEnter={() => setButtonHovered(prev => ({...prev, clean: true}))}
                onMouseLeave={() => setButtonHovered(prev => ({...prev, clean: false}))}
              >
                Clean the cluster
              </button>
              
              {/* Checkboxes */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '10px', 
                  cursor: 'pointer',
                  fontSize: '14px',
                  color: '#e5e7eb'
                }}>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="checkbox"
                      checked={formData.cleanBefore}
                      onChange={(e) => setFormData({...formData, cleanBefore: e.target.checked})}
                      style={{ 
                        appearance: 'none',
                        width: '18px', 
                        height: '18px',
                        backgroundColor: '#0a0a0a',
                        border: '1px solid #1f2937',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        position: 'relative',
                        outline: 'none'
                      }}
                    />
                    {formData.cleanBefore && (
                      <CheckCircle 
                        size={14} 
                        style={{ 
                          position: 'absolute', 
                          top: '2px', 
                          left: '2px', 
                          color: '#84cc16',
                          pointerEvents: 'none'
                        }} 
                      />
                    )}
                  </div>
                  <span style={{ fontWeight: '300' }}>Clean the cluster before run</span>
                </label>
                
                <label style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '10px', 
                  cursor: 'pointer',
                  fontSize: '14px',
                  color: '#e5e7eb'
                }}>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="checkbox"
                      checked={formData.cleanAfter}
                      onChange={(e) => setFormData({...formData, cleanAfter: e.target.checked})}
                      style={{ 
                        appearance: 'none',
                        width: '18px', 
                        height: '18px',
                        backgroundColor: '#0a0a0a',
                        border: '1px solid #1f2937',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        position: 'relative',
                        outline: 'none'
                      }}
                    />
                    {formData.cleanAfter && (
                      <CheckCircle 
                        size={14} 
                        style={{ 
                          position: 'absolute', 
                          top: '2px', 
                          left: '2px', 
                          color: '#84cc16',
                          pointerEvents: 'none'
                        }} 
                      />
                    )}
                  </div>
                  <span style={{ fontWeight: '300' }}>Clean the cluster after run</span>
                </label>
                
                <label style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '10px', 
                  cursor: 'pointer',
                  fontSize: '14px',
                  color: '#e5e7eb'
                }}>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="checkbox"
                      checked={formData.newDeployment}
                      onChange={(e) => setFormData({...formData, newDeployment: e.target.checked})}
                      style={{ 
                        appearance: 'none',
                        width: '18px', 
                        height: '18px',
                        backgroundColor: '#0a0a0a',
                        border: '1px solid #1f2937',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        position: 'relative',
                        outline: 'none'
                      }}
                    />
                    {formData.newDeployment && (
                      <CheckCircle 
                        size={14} 
                        style={{ 
                          position: 'absolute', 
                          top: '2px', 
                          left: '2px', 
                          color: '#84cc16',
                          pointerEvents: 'none'
                        }} 
                      />
                    )}
                  </div>
                  <span style={{ fontWeight: '300' }}>New deployment</span>
                </label>
              </div>
            </div>
          )}
        </div>
        </div>
        
        {/* Resize Handle */}
        {sidebarOpen && (
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              width: '4px',
              cursor: 'col-resize',
              backgroundColor: isResizing ? '#84cc16' : 'transparent',
              transition: 'background-color 0.2s ease'
            }}
            onMouseDown={startResizing}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#374151'}
            onMouseLeave={(e) => !isResizing && (e.currentTarget.style.backgroundColor = 'transparent')}
          />
        )}
      </div>

      {/* Compact Sidebar Toggle (open) — sidebarOpen が false のときだけ */}
      {!sidebarOpen && (
        <button
          aria-label="Open sidebar"
          onClick={() => setSidebarOpen(true)}
          title="Open sidebar"
          style={{
            position: 'fixed',
            top: '12px',
            left: '12px',
            width: '32px',
            height: '32px',
            borderRadius: '10px',
            backgroundColor: '#1f1f1f',
            border: '1px solid #374151',
            color: '#d1d5db',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
            zIndex: 1000,
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#2a2a2a';
            e.currentTarget.style.color = '#84cc16';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#1f1f1f';
            e.currentTarget.style.color = '#d1d5db';
          }}
        >
          <PanelLeftOpen size={18} />
        </button>
      )}
      
      {/* Main Content */}
      <div style={{ 
        flex: 1, 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        justifyContent: 'center', 
        padding: '32px',
        marginLeft: sidebarOpen ? '0' : '0',
        transition: 'margin-left 0.3s ease'
      }}>
        {/* Animated Logo with Eye */}
        <div 
          ref={logoRef}
          style={{
            width: '200px',
            height: '200px',
            position: 'relative',
            marginBottom: '0px',
            marginTop: '150px'
          }}
        >
          {/* ChaosEater icon */}
          <img
            src="/chaoseater_icon.png"
            style={{
              position: 'absolute',
              width: '80%',
              height: '80%',
              top: '10%',
              left: '10%',
              objectFit: 'contain',
              animation: 'rotate 30s linear infinite'
            }}
            onError={(e) => {
              e.target.style.display = 'none';
              e.target.nextSibling.style.display = 'flex';
            }}
          />
          
          {/* Simple Eye overlay - centered */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '40px',
            height: '40px',
            backgroundColor: '#ffffff',
            borderRadius: '50%',
            overflow: 'hidden'
          }}>
            {/* Black pupil that follows mouse */}
            <div style={{
              position: 'absolute',
              width: '20px',
              height: '20px',
              backgroundColor: '#000000',
              borderRadius: '50%',
              top: '50%',
              left: '50%',
              transform: `translate(calc(-50% + ${mousePosition.x}px), calc(-50% + ${mousePosition.y}px))`,
              transition: 'transform 0.1s ease-out'
            }}>
              {/* White highlight dot in upper right */}
              <div style={{
                position: 'absolute',
                width: '6px',
                height: '6px',
                backgroundColor: '#ffffff',
                borderRadius: '50%',
                top: '3px',
                right: '3px'
              }} />
            </div>
          </div>

          {/* CSS animation for rotation */}
          <style dangerouslySetInnerHTML={{__html: `
            @keyframes rotate {
              from {
                transform: rotate(0deg);
              }
              to {
                transform: rotate(-360deg);
              }
            }
          `}} />
        </div>
        
        {/* Title */}
        <h1 style={{ fontSize: '30px', fontWeight: '300', margin: '0 0 48px' }}>
          Let's dive into <span style={{ color: '#84cc16', fontWeight: '600' }}>Chaos</span> together :)
        </h1>
        
        {/* Spacer to push chatbox down */}
        <div style={{ flex: 1 }}></div>

        {/* Example Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '16px',
          marginBottom: '28px',
          width: '100%',
          maxWidth: '768px'
        }}>
          <div
            onClick={() => loadExample('nginx')}
            onMouseEnter={() => setHoveredExample('nginx')}
            onMouseLeave={() => setHoveredExample(null)}
            style={styles.exampleCard(hoveredExample === 'nginx')}
          >
            <div style={styles.exampleTitle(hoveredExample === 'nginx')}>example#1:</div>
            <div style={styles.exampleDesc(hoveredExample === 'nginx')}>Nginx w/ detailed CE instructions</div>
          </div>
          
          <div
            onClick={() => loadExample('nginxLimited')}
            onMouseEnter={() => setHoveredExample('nginxLimited')}
            onMouseLeave={() => setHoveredExample(null)}
            style={styles.exampleCard(hoveredExample === 'nginxLimited')}
          >
            <div style={styles.exampleTitle(hoveredExample === 'nginxLimited')}>example#2:</div>
            <div style={styles.exampleDesc(hoveredExample === 'nginxLimited')}>Nginx w/ limited experiment duration</div>
          </div>
          
          <div
            onClick={() => loadExample('sockshop')}
            onMouseEnter={() => setHoveredExample('sockshop')}
            onMouseLeave={() => setHoveredExample(null)}
            style={styles.exampleCard(hoveredExample === 'sockshop')}
          >
            <div style={styles.exampleTitle(hoveredExample === 'sockshop')}>example#3:</div>
            <div style={styles.exampleDesc(hoveredExample === 'sockshop')}>Sock shop w/ limited experiment duration</div>
          </div>
        </div>
        
        {/* Unified Chat Input Area */}
        <div style={{ 
          width: '100%', 
          maxWidth: '768px', 
          position: 'relative',
          marginBottom: '0px'
        }}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".yaml,.yml,.zip"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
          
          {/* Uploaded files display */}
          {uploadedFiles.length > 0 && (
            <div style={{ 
              marginBottom: '12px',
              padding: '12px',
              backgroundColor: '#1a1a1a',
              borderRadius: '8px',
              border: '1px solid #374151'
            }}>
              <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '10px', fontWeight: '500' }}>
                Uploaded files ({uploadedFiles.length}):
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {uploadedFiles.map((file, index) => (
                  <div key={index} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 12px',
                    backgroundColor: '#2a2a2a',
                    borderRadius: '16px',
                    fontSize: '12px',
                    color: '#e5e7eb',
                    border: '1px solid #374151'
                  }}>
                    <span style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {file.name}
                    </span>
                    <button
                      onClick={() => setUploadedFiles(files => files.filter((_, i) => i !== index))}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#9ca3af',
                        cursor: 'pointer',
                        padding: '2px',
                        display: 'flex',
                        alignItems: 'center',
                        borderRadius: '50%',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
                      onMouseLeave={(e) => e.currentTarget.style.color = '#9ca3af'}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <div
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            style={{ 
              position: 'relative',
              borderRadius: '8px',
              border: '1px solid #374151',
              backgroundColor: '#1f1f1f',
              transition: 'all 0.2s ease',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#84cc16';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#374151';
            }}
          >
            {/* Upper section - Text area */}
            <div style={{ position: 'relative' }}>
              {/* Custom placeholder text positioned left aligned */}
              {!formData.instructions.trim() && (
                <div style={{
                  position: 'absolute',
                  top: '16px',
                  left: '16px',
                  color: '#9ca3af',
                  fontSize: '16px',
                  pointerEvents: 'none',
                  zIndex: 1
                }}>
                  Input instructions for your Chaos Engineering...
                </div>
              )}
              
              <textarea
                value={formData.instructions}
                onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                rows={1}
                style={{
                  width: '100%',
                  padding: '16px',
                  backgroundColor: 'transparent',
                  borderRadius: '8px 8px 0 0',
                  border: 'none',
                  color: '#e5e7eb',
                  fontSize: '16px',
                  fontFamily: 'inherit',
                  resize: 'none',
                  outline: 'none',
                  transition: 'all 0.2s ease',
                  lineHeight: '24px',
                  boxSizing: 'border-box',
                  minHeight: '32px',
                  overflow: 'hidden'
                }}
                onFocus={(e) => e.target.parentElement.parentElement.style.borderColor = '#84cc16'}
                onBlur={(e) => e.target.parentElement.parentElement.style.borderColor = '#374151'}
                onInput={(e) => {
                  const ta = e.currentTarget;
                  ta.style.height = 'auto';
                  const max = 200;
                  const newHeight = Math.min(ta.scrollHeight, max);
                  ta.style.height = `${newHeight}px`;
                }}
              />
            </div>
            
            {/* Lower section - Controls */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              backgroundColor: '#1a1a1a',
              borderRadius: '0 0 8px 8px'
            }}>
              {/* Left side - File upload button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: '32px',
                  height: '32px',
                  padding: '0',
                  backgroundColor: 'transparent',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#9ca3af',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#374151';
                  e.currentTarget.style.color = '#84cc16';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = '#9ca3af';
                }}
                title="Add files"
              >
                <Paperclip size={18} />
              </button>
              
              {/* Right side - Send button */}
              <button
                onClick={handleSubmit}
                disabled={isLoading}
                style={{
                  width: '32px',
                  height: '32px',
                  padding: '0',
                  backgroundColor: '#84cc16',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#000000',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease',
                  opacity: isLoading ? 0.6 : 1,
                  boxShadow: '0 2px 8px rgba(132, 204, 22, 0.3)'
                }}
                onMouseEnter={(e) => {
                  if (!isLoading) {
                    e.currentTarget.style.backgroundColor = '#a3d635';
                    e.currentTarget.style.transform = 'scale(1.05)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#84cc16';
                  e.currentTarget.style.transform = 'scale(1)';
                }}
                title="Send (Enter to submit)"
              >
                {isLoading ? <Loader size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}