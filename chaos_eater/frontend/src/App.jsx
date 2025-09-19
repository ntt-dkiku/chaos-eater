import React, { useState, useEffect, useRef } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Send,
  CheckCircle,
  Eye,
  EyeOff,
  Loader,
  X,
  Paperclip,
  PanelLeftOpen,
  PanelLeftClose
} from 'lucide-react';
import './App.css';
import MessagesPanel from './components/MessagesPanel';


export default function ChaosEaterApp() {
  // === API constants & helpers ===
  // Pick API base from window or env; fall back to localhost.
  const API_BASE =
    (typeof window !== 'undefined' && window.NEXT_PUBLIC_CE_API) ||
    process.env.NEXT_PUBLIC_CE_API ||
    'http://localhost:8000';
  
  // Build WS URL that matches API_BASE protocol/host.
  const wsUrl = (path) => {
    try {
      const u = new URL(API_BASE);
      u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
      u.pathname = path;
      return u.toString();
    } catch {
      // Fallback: naïve replace
      return API_BASE.replace(/^http/, 'ws') + path;
    }
  };

  // Turn File objects into {name, content, size} (text) keeping paths if folder upload used.
  const readAsTextWithPath = (file) => {
    return new Promise((resolve) => {  // ← returnを追加
      const reader = new FileReader();
      reader.onload = (e) =>
        resolve({
          name: file.webkitRelativePath || file.name,
          content: e.target.result,
          size: file.size,
        });
      reader.readAsText(file);
    });
  };

  // ---------------------------------------------------------
  // State management
  // ---------------------------------------------------------
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
  
  // file uploading
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [backendProjectPath, setBackendProjectPath] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const [notification, setNotification] = useState(null);
  const [hoveredExample, setHoveredExample] = useState(null);
  const fileInputRef = useRef(null);
  const logoRef = useRef(null);
  // Streaming/chat states
  const [messages, setMessages] = useState([]); // [{role: 'assistant'|'user', content: string}]
  const [jobId, setJobId] = useState(null);
  const wsRef = useRef(null);
  const hideTimerRef = useRef(null);
  const [visible, setVisible] = useState(false);
  // model list
  const models = [
    'openai/gpt-4o-2024-08-06',
    'google/gemini-1.5-pro-latest',
    'anthropic/claude-3-5-sonnet-20241022',
    'ollama/qwen3:32b',
    'custom'
  ];
  const defaultModel = 'openai/gpt-4o-2024-08-06';
  const selectModelValue =
    !formData.model || formData.model.trim() === ''
      ? defaultModel
      : models.includes(formData.model)
        ? formData.model
        : 'custom';
  
  //--------------------------------------------------------------
  // cluster management
  //--------------------------------------------------------------
  // cluster list
  const [clusters, setClusters] = useState({
    all: [], used: [], available: [], mine: null,
  });
  const [clustersLoading, setClustersLoading] = useState(false);
  const [clustersError, setClustersError] = useState(null);

  // store session id in local（if you are in the same tab just keep using the same id）
  const sessionIdRef = useRef(
    typeof window !== 'undefined'
      ? (localStorage.getItem('ce_session_id') ||
        (localStorage.setItem('ce_session_id', crypto.randomUUID()), localStorage.getItem('ce_session_id')))
      : null
  );

  // helper functions
  async function fetchJSON(path, init = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
      ...init,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(t || `HTTP ${res.status}`);
    }
    return res.headers.get('content-type')?.includes('application/json')
      ? res.json()
      : res.text();
  }

  // get clusters（/clusters?session_id=...）
  const loadClusters = async () => {
    try {
      setClustersLoading(true);
      setClustersError(null);
      const q = encodeURIComponent(sessionIdRef.current || '');
      const data = await fetchJSON(`/clusters?session_id=${q}`);
      setClusters(prev => {
        return JSON.stringify(prev) === JSON.stringify(data) ? prev : data;
      });
      // apply it if you already claimed one and the form is unset
      if (!formData.cluster && data.mine && formData.cluster !== data.mine) {
        setFormData(prev => ({ ...prev, cluster: data.mine }));
      }
    } catch (e) {
      setClustersError(e.message || String(e));
    } finally {
      setClustersLoading(false);
    }
  };
  
  // 1st time & periodic update（60s）
  useEffect(() => {
    loadClusters();
    const id = setInterval(loadClusters, 60000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const claimCluster = async (preferred) => {
    const body = { session_id: sessionIdRef.current, preferred };
    const data = await fetchJSON(`/clusters/claim`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    setFormData(prev => ({ ...prev, cluster: data.cluster }));
    setNotification({ type: 'success', message: `Cluster claimed: ${data.cluster}` });
    await loadClusters();
  };
  
  const releaseCluster = async () => {
    try {
      await fetchJSON(`/clusters/release`, {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionIdRef.current }),
      });
    } catch (_) { }
  };
  
  // release the cluster by closing tab or transitioning the screen 
  useEffect(() => {
    const handler = () => { navigator.sendBeacon?.(`${API_BASE}/clusters/release`,
      new Blob([JSON.stringify({ session_id: sessionIdRef.current })], { type: 'application/json' })
    ); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
    
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

  // hide notification a few seconds later
  useEffect(() => {
    // auto-dismiss after 3s whenever notification changes
    if (notification) {
      setVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => {
        setVisible(false);
        // wait for fade-out (0.5s) before removing
        setTimeout(() => setNotification(null), 500);
      }, 3000);
    }
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [notification]);

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

  //--------
  // Styles
  //--------
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

  //----------------
  // file uploading
  //----------------  
  async function uploadZipToBackend(file) {
    const form = new FormData();
    form.append('file', file);
  
    const res = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      body: form
    });
  
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Upload failed: ${t || res.statusText}`);
    }
    const json = await res.json();
    if (!json?.project_path) throw new Error('Server did not return project_path');
    return json.project_path;
  }

  const handleFileUpload = async (event) => {
    const files = Array.from(event.target?.files || event.dataTransfer?.files || []);
    // const files = Array.from(event.target.files || []);
    if (!files.length) return;
    try {
      // If user selected a zip, upload it right now
      if (
        files.length === 1 &&
        (files[0].type?.includes('zip') || files[0].name.toLowerCase().endsWith('.zip'))
      ) {
        const projectPath = await uploadZipToBackend(files[0]);
        setBackendProjectPath(projectPath);
        setNotification({ type: 'success', message: 'File Uploaded!' });
        // Also show in the UI that a zip was chosen
        setUploadedFiles([{ name: files[0].name, size: files[0].size, content: '(zip uploaded to server)' }]);
        return;
      }
  
      // Otherwise, read the loose files into memory for optional zipping later
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

      const results = await Promise.all(filePromises);
      setUploadedFiles(prev => [...prev, ...results]);
      setNotification({ type: 'info', message: 'Files loaded. Click Send to start.' });
    } catch (err) {
      console.error(err);
      setNotification({ type: 'error', message: err.message || 'Upload failed' });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
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
          name: 'nginx.zip',
          project_path: 'examples/nginx',
          content: ''
        }],
        instructions: '- The Chaos-Engineering experiment must be completed within 1 minute.\n- List ONLY one steady state about Pod Count.\n- Conduct pod-kill'
      },
      nginxLimited: {
        files: [{
          name: 'nginx.zip',
          project_path: 'examples/nginx',
          content: ''
        }],
        instructions: 'The Chaos-Engineering experiment must be completed within 1 minute.'
      },
      sockshop: {
        files: [{
          name: 'sock-shop.zip',
          project_path: 'examples/sock-shop-2',
          content: ''
        }],
        instructions: '- The Chaos-Engineering experiment must be completed within 1 minute.\n- Test with URL: http://front-end.sock-shop.svc.cluster.local/'
      }
    };
    
    const example = examples[exampleType];
    if (example) {
      setUploadedFiles(example.files);
      setBackendProjectPath(example.files[0].project_path)
      setFormData(prev => ({ ...prev, instructions: example.instructions }));
    }
  };

  //------------------------------------------------------------
  // run ce cycle
  //------------------------------------------------------------
  const handleSubmit = async () => {
    if (!formData.cluster) {
      setNotification({ type: 'error', message: 'Please select a cluster' });
      return;
    }
    if (uploadedFiles.length === 0 && !formData.instructions.trim()) {
      setNotification({ type: 'error', message: 'Please upload files or provide instructions' });
      return;
    }
    setIsLoading(true);

    // 1. prepare request body for /jobs
    const payload = {
      project_path: backendProjectPath,
      ce_instructions: formData.instructions?.trim() || null,
      kube_context: formData.cluster,
      project_name: formData.projectName || 'chaos-eater',
      work_dir: null,
      clean_cluster_before_run: formData.cleanBefore,
      clean_cluster_after_run: formData.cleanAfter,
      is_new_deployment: formData.newDeployment,
      max_num_steadystates: formData.maxSteadyStates,
      max_retries: formData.maxRetries,
      namespace: 'chaos-eater'
    };

    try {
      // 2. create job
      const resp = await fetch(`${API_BASE}/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(formData.apiKey ? { 'x-api-key': formData.apiKey } : {}),
          ...(formData.model ? { 'x-model': formData.model } : {}),
        },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.detail || data.message || 'Failed to create job');
      }
      setJobId(data.job_id);

      // display dialog
      setPanelVisible(true);
      setMessages([]);

      // 3. show user instruction as a chat message
      if (formData.instructions.trim()) {
        setMessages((m) => [...m, { type: 'text', role: 'user', content: formData.instructions.trim() }]);
      }

      setNotification({ type: 'success', message: `Job created: ${data.job_id}` });
      
      // 4. connect WebSocket for streaming
      const socket = new WebSocket(wsUrl(`/jobs/${data.job_id}/stream`));
      wsRef.current = socket;

      socket.onopen = () => {
        setMessages((m) => [...m, { type: 'status', role: 'assistant', content: 'Connected. Streaming started…' }]);
      };
      socket.onmessage = (event) => {
        handleWsPayload(event.data);
      };
      socket.onerror = () => {
        setMessages((m) => [...m, { type: 'status', role: 'assistant', content: 'WebSocket error' }]);
      };
      socket.onclose = () => {
        setMessages((m) => [...m, { type: 'status', role: 'assistant', content: 'Stream closed' }]);
        setIsLoading(false);
      };
    } catch (err) {
      console.error(err);
      setNotification({ type: 'error', message: String(err.message || err) });
      setIsLoading(false);
    }
  };

  const [uploadHovered, setUploadHovered] = useState(false);
  const [logoHovered, setLogoHovered] = useState(false);
  const [buttonHovered, setButtonHovered] = useState({});

  //---------------------------
  // API key confiuration
  //---------------------------
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);

  function providerFromModel(model) {
    if (!model) return null;
    const p = String(model).split('/')[0]?.trim();
    if (["openai", "anthropic", "google", "ollama"].includes(p)) return p;
    return null;
  }

  async function checkProviderStatus(model) {
    const provider = providerFromModel(model);
    if (!provider) {
      setApiKeyConfigured(false);
      return;
    }
    try {
      const r = await fetch(`${API_BASE}/config/api-key?provider=${provider}`);
      const info = await r.json();
      setApiKeyConfigured(info?.configured);
    } catch {
      setApiKeyConfigured(false);
    }
  }

  useEffect(() => {
    if (formData.model) {
      checkProviderStatus(formData.model);
    }
  }, [formData.model]);

  async function saveApiKeyForCurrentModel(apiKey, model) {
    const provider = providerFromModel(model);
    if (!provider) throw new Error(`Unknown provider from model: ${model}`);
    if (!apiKey || !apiKey.trim()) throw new Error("API Key is empty");
  
    const res = await fetch(`${API_BASE}/config/api-key?persist=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, api_key: apiKey.trim() }),
    });
    if (!res.ok) {
      const t = await res.text().catch(()=>'');
      throw new Error(t || `HTTP ${res.status}`);
    }
    await checkProviderStatus(model);
    return res.json(); // { provider, configured }
  }

  //----------------
  // dialog display
  //----------------
  // Normalize to a lightweight shape for rendering (type is 'text' | 'code' | 'subheader' | 'status')
  const normalize = (msg) => ({ type: msg.type || 'text', role: msg.role || 'assistant', content: msg.content || msg.text || '', language: msg.language });
  // Toggle for showing the log/message panel
  const [panelVisible, setPanelVisible] = useState(false);
  // for smoothing streaming
  const messageQueueRef = useRef([]);
  const processTimerRef = useRef(null);
  const rafRef = useRef(null);

  // For appending partial chunks
  // Keep track of the most recent partial message state
  const partialStateRef = useRef(null);
  // Example: { open: true, role:'assistant', type:'code'|'text', language:'python'|undefined }

  function appendAssistantPartial(
    setter,
    chunk,
    {
      role = 'assistant',
      mode = 'delta',            // 'delta' means append, 'frame' means full replacement
      format = 'plain',          // 'plain' for text, 'code' for code blocks
      language = undefined,
      final = false              // true if this partial is the last one for the bubble
    } = {}
  ) {
    const type = (format === 'code') ? 'code' : 'text';
    const c = String(chunk ?? '');

    setter(prev => {
      const out = [...prev];
      const last = out[out.length - 1];

      // Check if the current partial should continue the same bubble
      const sameBubble =
        partialStateRef.current?.open &&
        partialStateRef.current?.role === role &&
        partialStateRef.current?.type === type &&
        (type === 'text' || partialStateRef.current?.language === (language || undefined));

      if (sameBubble && last && last.role === role && last.type === type) {
        // Append or replace depending on mode
        if (mode === 'frame') {
          // For frame mode, replace the content with the latest chunk
          last.content = c;
        } else {
          // For delta mode, append the new chunk to the end
          last.content = `${last.content || ''}${c}`;
        }
      } else {
        // Create a new bubble
        out.push({
          type, // 'text' | 'code'
          role,
          content: c,
          ...(type === 'code' ? { language } : {})
        });
        partialStateRef.current = { open: true, role, type, language: (type === 'code' ? language : undefined) };
      }

      if (final) {
        // Reset state so the next partial will start a new bubble
        partialStateRef.current = null;
      }
      return out;
    });
  }

  // Function to process queued messages in batches
  function processMessageQueue() {
    if (messageQueueRef.current.length === 0) return;
    
    // Extract messages from queue and process them together
    const messages = [...messageQueueRef.current];
    messageQueueRef.current = [];
    
    rafRef.current = requestAnimationFrame(() => {
      messages.forEach(payload => {
        // Original handleWsPayload processing
        let msg;
        try {
          msg = JSON.parse(payload);
        } catch {
          setMessages(m => [...m, { type: 'text', role: 'assistant', content: String(payload) }]);
          return;
        }
        
        if (msg?.type === 'event' && msg.event) {
          const ev = msg.event;
          if (ev.type === 'partial' && ev.partial != null) {
            appendAssistantPartial(setMessages, ev.partial, {
              role: ev.role || 'assistant',
              mode: ev.mode || 'delta',
              format: ev.format || 'plain',
              language: ev.language,
              filename: ev.filename,
              final: !!ev.final,
            });
            return;
          }
          if (ev.type === 'partial_end') {
            partialStateRef.current = null;
            return;
          }
          if (ev.type === 'write') {
            setMessages(m => [...m, { type: 'text', role: ev.role || 'assistant', content: ev.text || '' }]);
            return;
          }
          if (ev.type === 'code') {
            setMessages(m => [...m, { type: 'code', role: ev.role || 'assistant', content: ev.code || '', language: ev.language, filename: ev.filename }]);
            return;
          }
          if (ev.type === 'subheader') {
            setMessages(m => [...m, { type: 'subheader', role: ev.role || 'assistant', content: ev.text || '' }]);
            return;
          }
          setMessages(m => [...m, { type: 'text', role: 'assistant', content: JSON.stringify(ev) }]);
          return;
        }
        
        if (msg.partial != null) {
          appendAssistantPartial(setMessages, msg.partial, {
            role: msg.role || 'assistant',
            mode: msg.mode || 'delta',
            format: msg.format || 'plain',
            language: msg.language,
            final: !!msg.final,
          });
          return;
        }
        
        const content = msg.rich || msg.message || msg.progress || (msg.status ? `Status: ${msg.status}` : null);
        if (content != null) {
          console.log(content);
          return;
        }
        
        setMessages(m => [...m, { type: 'text', role: 'assistant', content: JSON.stringify(msg) }]);
      });
      
      rafRef.current = null;
    });
  }

  // Simplified version using only RAF
  function handleWsPayload(payload) {
    messageQueueRef.current.push(payload);
    
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        processMessageQueue();
        rafRef.current = null;
      });
    }
  }

  useEffect(() => {
    return () => {
      if (processTimerRef.current) {
        clearTimeout(processTimerRef.current);
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      messageQueueRef.current = [];
      try { wsRef.current?.close(); } catch {}
    };
  }, []);


  //
  //
  //
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
                  value={selectModelValue}
                  onChange={(e) => setFormData({...formData, model: e.target.value})}
                  onFocus={(e) => e.target.style.borderColor = '#374151'}
                  onBlur={(e) => e.target.style.borderColor = '#1f2937'}
                >
                  {models.map(model => (
                    <option key={model} value={model} style={{ backgroundColor: '#0a0a0a', padding: '8px' }}>{model}</option>
                  ))}
                </select>
              </div>
              
              {selectModelValue === 'custom' && (
                <div>
                  <label style={{ fontSize: '12px', color: '#6b7280', fontWeight: '400', letterSpacing: '0.5px' }}>Custom model</label>
                  <input
                    type="text"
                    placeholder="ollama/gpt-oss:20b"
                    defaultValue={formData.model && !models.includes(formData.model) ? formData.model : ""}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const val = e.currentTarget.value.trim();
                        setFormData(prev => ({
                          ...prev,
                          model: val || defaultModel
                        }));
                      }
                    }}
                    onBlur={(e) => {
                      const val = e.currentTarget.value.trim();
                      setFormData(prev => ({
                        ...prev,
                        model: val || defaultModel
                      }));
                    }}
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
                      transition: 'border-color 0.2s ease',
                      boxSizing: 'border-box',
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = '#374151')}
                    onBlurCapture={(e) => (e.currentTarget.style.borderColor = '#1f2937')}
                  />
                </div>
              )}

              {/* API Key */}
              {providerFromModel(formData.model) !== "ollama" && ( // Ollama does not require API key
                <div>
                  <label style={{ fontSize: '12px', color: '#6b7280', fontWeight: '400', letterSpacing: '0.5px' }}>API key</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={formData.apiKeyVisible ? "text" : "password"}
                      // placeholder="Enter your API key"
                      placeholder={apiKeyConfigured ? "Your API key is already set" : "Enter your API key"}
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
                        transition: 'border-color 0.2s ease',
                        boxSizing: 'border-box',
                      }}
                      value={formData.apiKey}
                      onChange={(e) => setFormData({...formData, apiKey: e.target.value})}
                      onFocus={(e) => e.target.style.borderColor = '#374151'}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          try {
                            const r = await saveApiKeyForCurrentModel(formData.apiKey, formData.model);
                            setNotification({ type: 'success', message: `API key saved for ${r.provider}` });
                            setFormData(prev => ({ ...prev, apiKey: '' }));
                          } catch (err) {
                            setNotification({ type: 'error', message: `Save failed: ${err.message || err}` });
                          }
                        }
                      }}
                      onBlur={async (e) => {
                        e.target.style.borderColor = '#1f2937';
                        if (formData.apiKey.trim()) {
                          try {
                            const r = await saveApiKeyForCurrentModel(formData.apiKey, formData.model);
                            setNotification({ type: 'success', message: `API key saved for ${r.provider}` });
                            setFormData(prev => ({ ...prev, apiKey: '' }));
                          } catch (err) {
                            setNotification({ type: 'error', message: `Save failed: ${err.message || err}` });
                          }
                        }
                      }}
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
              )}

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
                  onChange={async (e) => {
                    const val = e.target.value;
                    if (!val) return;
                    try {
                      await claimCluster(val);
                    } catch (err) {
                      setNotification({ type: 'error', message: `Claim failed: ${err.message || err}` });
                    }
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#374151'}
                  onBlur={(e) => e.target.style.borderColor = '#1f2937'}
                  disabled={clustersLoading}
                >
                  {clustersLoading && (
                    <option value="" style={{ backgroundColor: '#0a0a0a' }}>
                      Loading clusters...
                    </option>
                  )}
                  {!clustersLoading && clustersError && (
                    <option value="" style={{ backgroundColor: '#0a0a0a' }}>
                      Failed to load clusters: {clustersError}
                    </option>
                  )}
                  {!clustersLoading && !clustersError && clusters.available.length === 0 && (
                    <option value="" style={{ backgroundColor: '#0a0a0a' }}>
                      No clusters available
                    </option>
                  )}
                  {/* 自分のを先頭グループに（あれば） */}
                  {clusters.mine && (
                    <optgroup label="My reserved">
                      <option value={clusters.mine}>{clusters.mine}</option>
                    </optgroup>
                  )}
                  {/* 空き（自分のを除く） */}
                  {clusters.available.filter(c => c !== clusters.mine).length > 0 && (
                    <optgroup label="Available">
                      {clusters.available.filter(c => c !== clusters.mine).map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </optgroup>
                  )}
                  {/* 参考情報として All（選択不可） */}
                  {clusters.all.length > 0 && (
                    <optgroup label="All (disabled)">
                      {clusters.all.map(c => (
                        <option key={`all-${c}`} value="" disabled>
                          {c}{clusters.used.includes(c) ? ' (in use)' : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
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

      {/* Compact Sidebar Toggle (open) */}
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
          transition: 'margin-left 0.3s ease',
          minHeight: 0
      }}>
        {/* dialog */}
        <div style={{ 
          position: panelVisible ? 'relative' : 'absolute',
          visibility: panelVisible ? 'visible' : 'hidden',
          opacity: panelVisible ? 1 : 0,
          width: '100%',
          maxWidth: '768px', 
          height: panelVisible ? 'calc(100% - 150px)' : '0',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'stretch',
          transition: 'opacity 0.3s ease',
          pointerEvents: panelVisible ? 'auto' : 'none',
          overflow: 'hidden',
          minHeight: 0,
        }}>
          <MessagesPanel messages={messages} />
        </div>

        {/* landing image */}
        {!panelVisible && (
          <>
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
            <h1 style={{ fontSize: '30px', fontWeight: 'bold', fontWeight: '300', margin: '0 0 48px' }}>
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
          </>
        )}
        
        {/* Unified Chat Input Area */}
        <div style={{ 
          width: '100%', 
          maxWidth: '768px', 
          position: 'relative',
          marginBottom: '0px',
          flexShrink: 0 
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
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                backgroundColor: '#1a1a1a',
                borderRadius: '0 0 8px 8px',
              }}
            >
              {/* Left group */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    width: 32,
                    height: 32,
                    padding: 0,
                    backgroundColor: 'transparent',
                    border: 'none',
                    borderRadius: 6,
                    color: '#9ca3af',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease',
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
              </div>

              {/* Right group: [toast][Send] */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {notification && (
                  <div
                    style={{
                      backgroundColor:
                        notification.type === 'error' ? '#7f1d1d' : '#84cc16',
                      color:
                        notification.type === 'error' ? '#e5e7eb' : '#000000',
                      border: 'none',
                      borderRadius: 6,
                      padding: '6px 10px',
                      fontSize: 13,
                      opacity: visible ? 1 : 0,
                      transition: 'opacity 0.5s ease',
                      whiteSpace: 'nowrap',
                      maxWidth: 360,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {notification.message}
                  </div>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={isLoading}
                  style={{
                    width: 32,
                    height: 32,
                    padding: 0,
                    backgroundColor: '#84cc16',
                    border: 'none',
                    borderRadius: 6,
                    color: '#000000',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease',
                    opacity: isLoading ? 0.6 : 1,
                    boxShadow: '0 2px 8px rgba(132, 204, 22, 0.3)',
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
    </div>
  );
}