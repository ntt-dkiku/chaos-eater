// @ts-nocheck
// TODO: Gradually add TypeScript types to this large component
// This file is in the process of being migrated to TypeScript
import React, { useState, useEffect, useRef } from 'react';
import {
  ChevronDown,
  Send,
  Pause,
  CheckCircle,
  PlusCircle,
  Wrench,
  MoreHorizontal,
  BarChart3,
  Trash2,
  Edit3,
  Eye,
  EyeOff,
  Loader,
  X,
  Paperclip,
  PanelLeftOpen,
  PanelLeftClose
} from 'lucide-react';
import {
  ensureSession,
  listSnapshots,
  getSnapshot,
  createSnapshot,
  updateSnapshot,
  renameSnapshot,
  deleteSnapshot,
  clearSnapshots
} from './lib/useSessionStore';
import './App.css';
import MessagesPanel from './components/MessagesPanel';
import NumberField from "./components/NumberField";
import Collapse from "./components/Collapse";
import LandingLogo from './components/LandingLogo';
import LandingMessage from './components/LandingMessage';
import CleanClusterButton from './components/CleanClusterButton';
import StatsPanel from './components/StatsPanel';


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
  const SIDEBAR_WIDTH = 280
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState({
    general: false,
    usage: true,
    cycles: true
  });
  
  const [formData, setFormData] = useState({
    model: 'openai/gpt-4.1',
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
    maxSteadyStates: 2,
    maxRetries: 3,
  });
  
  // file uploading
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [backendProjectPath, setBackendProjectPath] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  // for drafting
  const [draftInstructions, setDraftInstructions] = useState('');
  const [draftFiles, setDraftFiles] = useState([]);
  // define a key for resetting the height of textarea
  const [composerKey, setComposerKey] = useState(0);
  // ollama model pulling
  const [ollamaPull, setOllamaPull] = useState({
    inProgress: false,
    pct: null,      // 0-100 or null when unknown
    status: '',     // e.g. "downloading", "verifying"
    model: '',      // short model name like "gpt-oss:20b"
    abort: null     // AbortController
  });
  const seenModelsRef = useRef(new Set());
  const [pullNonce, setPullNonce] = useState(0);

  const [notification, setNotification] = useState(null);
  const [hoveredExample, setHoveredExample] = useState(null);
  const fileInputRef = useRef(null);

  // Streaming/chat states
  const [messages, setMessages] = useState([]); // [{role: 'assistant'|'user', content: string}]
  const [jobId, setJobId] = useState(null);
  const wsRef = useRef(null);
  const hideTimerRef = useRef(null);
  const [visible, setVisible] = useState(false);
  // model list
  const models = [
    'openai/gpt-4.1',
    'openai/gpt-4o-2024-08-06',
    'openai/gpt-5.1-2025-11-13',
    'openai/gpt-5.2',
    // 'anthropic/claude-3-5-sonnet-20241022', this model was removed from API
    'anthropic/claude-sonnet-4-5-20250929',
    'anthropic/claude-opus-4-5-20251101',
    'google/gemini-2.5-pro',
    'google/gemini-3-pro-preview',
    // 'google/gemini-1.5-pro-latest', this model was removed from API
    'ollama/gpt-oss:20b',
    'ollama/gpt-oss:120b',
    'custom'
  ];
  const defaultModel = 'openai/gpt-4.1';
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
      }, 10000);
    }
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [notification]);

  //----------------
  // Ollama pulling
  //----------------
  const ghostButtonStyle = {
    padding: '10px 16px',
    backgroundColor: '#1f1f1f',
    border: '1px solid #374151',
    color: '#e5e7eb',
    borderRadius: 6,
    fontSize: 13,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    transition: 'all 0.2s ease'
  };
  // Auto-hide pull progress after success or error
  const retryOllamaPull = (force = false) => {
    const model = formData.model?.trim();
    if (!model) return;
    if (force) {
      seenModelsRef.current.delete(model);
    }
    setPullNonce(n => n + 1);
  };

  useEffect(() => {
    if (ollamaPull.status === 'success') {
      const t = setTimeout(() => {
        setOllamaPull({
          inProgress: false,
          pct: null,
          status: '',
          model: '',
          abort: null
        });
      }, 10000);

      return () => clearTimeout(t);
    }
  }, [ollamaPull.status, pullNonce]);

  // Clear pull banner when model changes away from the failed/finished one
  useEffect(() => {
    const currentShort = shortOllamaName(formData.model || '');
    // If provider is not ollama or the selected model is different, hide the banner
    if (providerFromModel(formData.model) !== 'ollama' ||
        (ollamaPull.model && ollamaPull.model !== currentShort)) {
      setOllamaPull({ inProgress: false, pct: null, status: null, model: null, abort: null });
    }
  }, [formData.model]);

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
        const one = { name: files[0].name, size: files[0].size, content: '(zip uploaded to server)' };
        setUploadedFiles([one]);
        setDraftFiles([one]);
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
      setDraftFiles(prev => [...prev, ...results]);
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
        instructions: '- The Chaos-Engineering experiment must be completed within 1 minute.\n- List ONLY one steady state about Pod Count.\n- Conduct pod-kill in the experiment phase'
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
        instructions: [
          '- The Chaos-Engineering experiment must be completed within 1 minute.',
          '- When using k6 in steady-state definition, always select a request URL from the following options (other requests are invalid):',
          '  1. http://front-end.sock-shop.svc.cluster.local/',
          '  2. http://front-end.sock-shop.svc.cluster.local/catalogue?size=10',
          '  3. http://front-end.sock-shop.svc.cluster.local/detail.html?id=<ID>',
          '     Replace <ID> with an available ID: [`03fef6ac-1896-4ce8-bd69-b798f85c6e0b`, `3395a43e-2d88-40de-b95f-e00e1502085b`, `510a0d7e-8e83-4193-b483-e27e09ddc34d`, `808a2de1-1aaa-4c25-a9b9-6612e8f29a38`, `819e1fbf-8b7e-4f6d-811f-693534916a8b`, `837ab141-399e-4c1f-9abc-bace40296bac`, `a0a4f044-b040-410d-8ead-4de0446aec7e`, `d3588630-ad8e-49df-bbd7-3167f7efb246`, `zzz4f044-b040-410d-8ead-4de0446aec7e`]',
          '  4. http://front-end.sock-shop.svc.cluster.local/category/',
          '  5. http://front-end.sock-shop.svc.cluster.local/category?tags=<TAG>',
          '     Replace <TAG> with an available tag: [`magic`, `action`, `blue`, `brown`, `black`, `sport`, `formal`, `red`, `green`, `skin`, `geek`]',
          '  6. http://front-end.sock-shop.svc.cluster.local/basket.html',
        ].join('\n'),
      }
    };
    
    const example = examples[exampleType];
    if (example) {
      setUploadedFiles(example.files);
      setDraftFiles(example.files);
      setBackendProjectPath(example.files[0].project_path)
      setDraftInstructions(example.instructions);

      // Auto-adjust textarea height after setting the text
      setTimeout(() => {
        const textarea = document.querySelector('textarea');
        if (textarea) {
          textarea.style.height = 'auto';
          const max = 200;
          const newHeight = Math.min(textarea.scrollHeight, max);
          textarea.style.height = `${newHeight}px`;
        }
      }, 0);
    }
  };

  //------------------------------------------------------------
  // run ce cycle
  //------------------------------------------------------------
  const [runState, setRunState] = useState('idle');

  const handleStop = async () => {
    setRunState('paused');
    setIsLoading(false);

    // Close WebSocket
    if (wsRef.current) {
      try {
        wsRef.current.close();
        wsRef.current = null;
      } catch (e) {
        console.error('Failed to close WebSocket:', e);
      }
    }

    if (!jobId) {
      setNotification({ type: 'info', message: 'No active job' });
      return;
    }

    // Send pause request (instead of cancel/delete)
    try {
      const response = await fetch(`${API_BASE}/jobs/${jobId}/pause`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        if (response.status === 404) {
          setNotification({ type: 'warning', message: 'Job not found' });
          return;
        } else if (response.status === 400) {
          setNotification({
            type: 'warning',
            message: errorData.detail || 'Job may not be running or already finished'
          });
          return;
        } else {
          throw new Error(`Pause failed: ${response.statusText}`);
        }
      }

      const data = await response.json();
      setNotification({
        type: 'success',
        message: `Job paused at phase: ${data.current_phase || 'unknown'}`
      });

    } catch (error) {
      console.error('Pause failed:', error);
      setNotification({
        type: 'error',
        message: 'Failed to pause job. Backend may still be processing.'
      });
    }
  };

  // resume from paused state
  const handleResume = async () => {
    if (!jobId) {
      setNotification({ type: 'info', message: 'No job to resume' });
      return;
    }

    setIsLoading(true);
    setRunState('running');

    try {
      const response = await fetch(`${API_BASE}/jobs/${jobId}/resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(formData.apiKey ? { 'x-api-key': formData.apiKey } : {}),
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to resume job');
      }

      const data = await response.json();
      const resumePoint = data.resume_from_agent
        ? `${data.resume_from}/${data.resume_from_agent}`
        : (data.resume_from || 'beginning');
      setNotification({
        type: 'success',
        message: `Resuming from: ${resumePoint}`
      });

      // Reconnect WebSocket for streaming
      const socket = new WebSocket(wsUrl(`/jobs/${jobId}/stream`));
      wsRef.current = socket;

      socket.onopen = () => {
        setMessages((m) => [...m, { type: 'status', role: 'assistant', content: 'Resumed. Streaming restarted…' }]);
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
        setRunState((prev) => (prev === 'paused' ? 'paused' : 'completed'));
      };

    } catch (error) {
      console.error('Resume failed:', error);
      setRunState('paused');
      setIsLoading(false);
      setNotification({
        type: 'error',
        message: error.message || 'Failed to resume job'
      });
    }
  };

  // Refresh session: start a new cycle
  const handleNewCycle = async () => {
    // Stop running job if exists
    if (jobId && runState === 'running') {
      try {
        await fetch(`${API_BASE}/jobs/${jobId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' }
        });
        console.log(`Stopped job ${jobId} before new cycle`);
      } catch (err) {
        console.warn("Job stop failed:", err);
      }
    }
  
    // Clear current state without changing session ID
    setMessages([]);
    setPanelVisible(false);
    setJobId(null);
    setRunState('idle');
    setIsLoading(false);
    setUploadedFiles([]);
    setDraftFiles([]);
    setDraftInstructions('');
    setBackendProjectPath(null);
    setCurrentSnapshotId(null);  // Detach from current snapshot
    partialStateRef.current = null;
    messageQueueRef.current = [];
    
    // Reset form to defaults but keep API key and cluster
    setFormData(prev => ({
      ...prev,
      instructions: '',
      projectName: 'chaos-project',
      cleanBefore: true,
      cleanAfter: true,
      newDeployment: true,
      temperature: 0.0,
      seed: 42,
      maxSteadyStates: 2,
      maxRetries: 3,
    }));
    
    // Clear any pending timers
    if (processTimerRef.current) {
      clearTimeout(processTimerRef.current);
      processTimerRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  // Download artifact (.zip)
  const handleDownload = async (pathOrUrl, fallbackName) => {
    try {
      await downloadFromApi({
        API_BASE,
        pathOrUrl,
        suggestedFilename: fallbackName,
        // headers: { ...(formData.apiKey ? { 'x-api-key': formData.apiKey } : {}) } // if you need auth
      });
      setNotification({ type: 'success', message: 'Download started' });
    } catch (err) {
      setNotification({ type: 'error', message: err.message || 'Download failed' });
    }
  };

  // History management
  async function purgeBySnapshot(snap) {
    const jid = snap?.jobId;
    if (!jid) return;
    try {
      const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jid)}/purge?delete_files=true`, {
        method: 'DELETE'
      });
      const body = await res.json().catch(()=> ({}));
      if (!res.ok) {
        throw new Error(body?.detail || `HTTP ${res.status}`);
      }

      const deleted = Array.isArray(body?.deleted_files) ? body.deleted_files : [];
      console.debug('[purge result]', jid, deleted);
      const failed = deleted.filter(d => d && d.deleted === false);
      if (failed.length) {
        setNotification({ 
          type: 'error', 
          message: `Some paths not deleted: ${failed.map(f=>`${f.path || ''} (${f.reason || 'unknown'})`).join(', ')}`
        });
      }
    } catch (_) {
    }
  }

  const handleClearAllSnapshots = async () => {
    if (!sessionIdRef.current) return;
    const ok = window.confirm('All snapshots will be deleted. Continue?');
    if (!ok) return;
    
    try {
      const all = await listSnapshots(sessionIdRef.current);
      await Promise.allSettled(all.map(purgeBySnapshot));

      await clearSnapshots(sessionIdRef.current);
      setSnapshots([]);
      if (currentSnapshotId) setCurrentSnapshotId(null);
      setNotification({ type: 'success', message: 'All snapshots deleted' });
    } catch (e) {
      setNotification({ type: 'error', message: `Delete failed: ${e.message || e}` });
    }
  };

  const handleDeleteSnapshot = async (id) => {
    const ok = window.confirm('Delete this snapshot?');
    if (!ok) return;

    try {
      const snap = await getSnapshot(id); 
      await purgeBySnapshot(snap);
      await deleteSnapshot(id);
      setSnapshots(prev => prev.filter(s => s.id !== id));
      if (currentSnapshotId === id) {
        setCurrentSnapshotId(null);
      }
      setNotification({ type: 'success', message: 'Snapshot deleted' });
    } catch (e) {
      setNotification({ type: 'error', message: `Delete failed: ${e.message || e}` });
    } finally {
      setOpenMenuId(null);
    }
  };
  
  const handleRenameSnapshot = async (id, oldTitle) => {
    const title = window.prompt('New name', oldTitle || '');
    if (title == null) return; // canceled
    const newTitle = title.trim();
    if (!newTitle) return;
    try {
      await renameSnapshot(id, newTitle);
      setSnapshots(prev => prev.map(s => (s.id === id ? { ...s, title: newTitle } : s)));
      setNotification({ type: 'success', message: 'Renamed' });
    } catch (e) {
      setNotification({ type: 'error', message: `Rename failed: ${e.message || e}` });
    } finally {
      setOpenMenuId(null);
    }
  };
    
  // submission
  const handleSubmit = async () => {
    if (!formData.cluster) {
      setNotification({ type: 'error', message: 'Please select a cluster' });
      return;
    }
    if (uploadedFiles.length === 0) {
      setNotification({ type: 'error', message: 'Please upload your project' });
      return;
    }
    if (ollamaPull.inProgress) {
      setNotification({ type: 'info', message: 'Model pull is in progress. Please wait.' });
      return;
    }
    // model verification (ollama)
    const model = formData.model?.trim();
    if (providerFromModel(model) === 'ollama') {
      try {
        const { exists, short } = await verifyOllamaModelExists(API_BASE, model);
        if (!exists) {
          setNotification({
            type: 'error',
            message: `Ollama model "${short}" is not available locally. Please pull it first.`
          });
          return; // stop submission
        }
      } catch (err) {
        setNotification({ type: 'error', message: `Failed to verify Ollama model: ${err.message || err}` });
        return;
      }
    }
    setIsLoading(true);
    setRunState('running');
    
    // 1. prepare request body for /jobs
    const effectiveInstructions = draftInstructions?.trim() || formData.instructions?.trim() || "";
    setFormData(prev => ({ ...prev, instructions: effectiveInstructions }));

    const payload = {
      project_path: backendProjectPath,
      ce_instructions: effectiveInstructions,
      kube_context: formData.cluster,
      project_name: formData.projectName || 'chaos-eater',
      work_dir: null,
      clean_cluster_before_run: formData.cleanBefore,
      clean_cluster_after_run: formData.cleanAfter,
      is_new_deployment: formData.newDeployment,
      model_name: formData.model,
      temperature: formData.temperature,
      seed: formData.seed,
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

      // 3. show user inputs as a chat message
      const fileLines = uploadedFiles.map(f => `${f.name}`).join(', ');
      const combinedUserMsg = [
        uploadedFiles.length ? `**Project:** ${fileLines}` : null,
        effectiveInstructions ? `**Instructions:**\n${effectiveInstructions}` : null,
      ].filter(Boolean).join('\n\n');

      if (combinedUserMsg) {
        setMessages((m) => [...m, {
          type: 'text',
          role: 'user',
          content: combinedUserMsg }]);
      }

      setNotification({ type: 'success', message: `Job created: ${data.job_id}` });
      
      // reset draft
      setDraftInstructions('');
      setDraftFiles([]);
      setComposerKey(k => k + 1);

      // Create a snapshot only on the first submit in this tab/session.
      try {
        if (!currentSnapshotId && !creatingSnapshotRef.current) {
          creatingSnapshotRef.current = true;
          const snap = await createSnapshot(
            sessionIdRef.current,
            `Project ${new Date().toLocaleString()}`, // title is up to you
            {
              jobId: data.job_id,
              jobWorkDir: data.work_dir,  // Save work_dir for job restoration
              messages,
              panelVisible: true,
              backendProjectPath,
              uploadedFilesMeta: uploadedFiles.map(f => ({ name: f.name, size: f.size })),
              formData: { ...formData, apiKey: '' },
            }
          );
          setCurrentSnapshotId(snap.id);
          // Prepend the new snapshot to keep newest-first by creation, without reordering later.
          setSnapshots(prev => [snap, ...prev]);
        }
      } finally {
        creatingSnapshotRef.current = false;
      }

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
        setRunState((prev) => (prev === 'paused' ? 'paused' : 'completed'));
      };
    } catch (err) {
      console.error(err);
      setNotification({ type: 'error', message: String(err.message || err) });
      setIsLoading(false);
      setRunState('idle');
    }
  };

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

  // Auto-pull when model becomes an Ollama model and not present locally
  const skipConfirmOnceRef = useRef(false);
  const lastModelRef = useRef(null);
  useEffect(() => {
    const model = formData.model?.trim();
    if (!model) return;
    if (providerFromModel(model) !== 'ollama') return;
    const changed = lastModelRef.current !== model;
    if (changed) {
      skipConfirmOnceRef.current = false;
      setOllamaPull({ inProgress:false, pct:null, status:null, model:null, abort:null });
    }
    lastModelRef.current = model;

    if (seenModelsRef.current.has(model)) return;

    (async () => {
      try {
        const { exists, short } = await verifyOllamaModelExists(API_BASE, model);
        if (exists) {
          seenModelsRef.current.add(model);
          return;
        }

        // show confirm only if it's not a retry
        if (!skipConfirmOnceRef.current) {
          const ok = window.confirm(`Ollama model "${short}" is not available locally. Pull now?`);
          if (!ok) {
            setNotification({ type: 'warning', message: `Model "${short}" is not available.` });
            return;
          }
        }
        skipConfirmOnceRef.current = false;

        const ac = new AbortController();
        setOllamaPull({
          inProgress: true,
          pct: null,
          status: 'starting',
          model: short,
          abort: ac
        });

        await pullOllamaModel(
          API_BASE,
          model,
          (ev) => {
            let pct = null;
            if (typeof ev?.completed === 'number' && typeof ev?.total === 'number' && ev.total > 0) {
              pct = Math.floor((ev.completed / ev.total) * 100);
            }
            setOllamaPull(prev => ({
              ...prev,
              pct,
              status: ev?.status || prev.status
            }));
          },
          ac.signal
        );

        await waitOllamaTag(API_BASE, short);

        setOllamaPull({ inProgress: false, pct: 100, status: 'success', model: short, abort: null });
        setNotification({ type: 'success', message: `Pull completed: "${short}"` });
        seenModelsRef.current.add(model);
      } catch (e) {
        setOllamaPull(prev => ({ ...prev, inProgress: false, abort: null }));
        setNotification({ type: 'error', message: `Ollama pull failed: ${e.message || e}` });
      }
    })();
  }, [formData.model, pullNonce]);

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

  //--------------
  // Ollama model
  //--------------
  /** Convert "ollama/gpt-oss:20b" -> "gpt-oss:20b". If already short, return as-is. */
  function shortOllamaName(modelFull) {
    return String(modelFull).startsWith("ollama/")
      ? modelFull.slice("ollama/".length)
      : modelFull;
  }

  /** Check existence of an Ollama model via backend verify endpoint. */
  async function verifyOllamaModelExists(API_BASE, modelFull) {
    const short = shortOllamaName(modelFull);
    const res = await fetch(`${API_BASE}/ollama/verify?model=${encodeURIComponent(short)}`);
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();
    return { exists: !!json.exists, short };
  }

  /**
   * Pull an Ollama model and wait until the server streams a final `{ "status": "success" }`.
   * This function resolves only after pull is fully completed.
   */
  async function pullOllamaModel(API_BASE, modelFull, onProgress, signal) {
    const short = shortOllamaName(modelFull);
    const res = await fetch(`${API_BASE}/ollama/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: short }),
      signal
    });
    if (!res.ok) throw new Error(await res.text());

    // Read NDJSON stream to the end
    const reader = res.body.getReader();
    const decoder = new TextDecoder(); // Decode bytes -> string chunks
    let buffer = '';
    let success = false;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse by newline (NDJSON)
      for (;;) {
        const nl = buffer.indexOf('\n');
        if (nl < 0) break;
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;

        let ev;
        try { ev = JSON.parse(line); }
        catch { ev = { status: line }; }

        // Optional UI hook
        onProgress?.(ev);

        // Ollama finishes with {"status": "success"}
        if (ev.status === 'success') success = true;
      }
    }

    if (!success) throw new Error('Pull did not complete (no "success" event).');
    return { ok: true, model: short };
  }

  /** After pull, /api/tags may lag; poll verify a few times before proceeding. */
  async function waitOllamaTag(API_BASE, short, { tries = 6, delay = 1000 } = {}) {
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(`${API_BASE}/ollama/verify?model=${encodeURIComponent(short)}`);
        if (r.ok) {
          const j = await r.json();
          if (j.exists) return true;
        }
      } catch {}
      await new Promise(r => setTimeout(r, delay));
    }
    return false;
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
          if (ev.type === 'iframe') {
            setMessages(m => [...m, { type: 'iframe', role: ev.role || 'assistant', content: ev.url || '' }]);
            return;
          }
          if (ev.type === 'tag') {
            setMessages(m => [...m, { type: 'tag', role: ev.role || 'assistant', content: ev.text || '', color: ev.color, background: ev.background }]);
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

  //-----------------
  // snapshot saving
  //-----------------
  // IndexedDB linking
  const [snapshots, setSnapshots] = useState([]);
  const [currentSnapshotId, setCurrentSnapshotId] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null); // kebab menu open target
  const [hoveredSnapshotId, setHoveredSnapshotId] = useState(null);
  const creatingSnapshotRef = useRef(false);   // prevent duplicate create on rapid clicks
  const persistDebounceRef = useRef(null);     // debounce timer id
  const snapshotKey = currentSnapshotId
    ? `snap:${currentSnapshotId}`
    : (jobId ? `job:${jobId}` : 'none');

  useEffect(() => {
    // Ensure IndexedDB session and load snapshot list
    (async () => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      await ensureSession(sid);
      const list = await listSnapshots(sid);
      // Order by createdAt (newest first). This list is fixed afterwards.
      const sorted = [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setSnapshots(sorted);
      // If you want to auto-attach the latest snapshot on reload, uncomment:
      // if (sorted.length > 0) {
      //   const last = sorted[0];
      //   setCurrentSnapshotId(last.id);
      //   setMessages(last.messages || []);
      //   setPanelVisible(!!last.panelVisible);
      //   setBackendProjectPath(last.backendProjectPath || null);
      //   setUploadedFiles((last.uploadedFilesMeta || []).map(m => ({ name: m.name, size: m.size, content: '' })));
      //   setFormData(prev => ({ ...prev, ...(last.formData || {}), apiKey: '' }));
      // }
    })();
  }, []);

  useEffect(() => {
    if (!currentSnapshotId) return;
  
    const payload = {
      messages,
      panelVisible,
      backendProjectPath,
      uploadedFilesMeta: uploadedFiles.map(f => ({ name: f.name, size: f.size })),
      formData: { ...formData, apiKey: '' },
    };
  
    // debounce to avoid excessive writes
    if (persistDebounceRef.current) clearTimeout(persistDebounceRef.current);
    persistDebounceRef.current = setTimeout(async () => {
      try {
        await updateSnapshot(currentSnapshotId, payload);
      } catch (e) {
        console.error('snapshot update failed', e);
      }
    }, 600);
  
    return () => {
      if (persistDebounceRef.current) {
        clearTimeout(persistDebounceRef.current);
        persistDebounceRef.current = null;
      }
    };
  }, [messages, panelVisible, backendProjectPath, uploadedFiles, formData, currentSnapshotId]);

  // close kebab menu when clicking outside
  useEffect(() => {
    const onDocClick = () => setOpenMenuId(null);
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  //-------------------
  // artifact download
  //-------------------
  function resolveApiUrl(API_BASE, pathOrUrl) {
    try {
      const u = new URL(pathOrUrl);
      return u.toString(); // already absolute
    } catch {
      return `${API_BASE}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
    }
  }

  /**
   * Download a file and trigger a save dialog.
   * Respects Content-Disposition if present; falls back to suggestedFilename.
   */
  async function downloadFromApi({ API_BASE, pathOrUrl, suggestedFilename, headers = {} }) {
    const url = resolveApiUrl(API_BASE, pathOrUrl);
    const res = await fetch(url, { method: 'GET', headers });

    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json())?.detail || ''; } catch {}
      throw new Error(detail || `Download failed (HTTP ${res.status})`);
    }

    // Try parse filename from Content-Disposition
    let filename = suggestedFilename || 'download';
    const cd = res.headers.get('Content-Disposition') || res.headers.get('content-disposition');
    if (cd && /filename\*=UTF-8''([^;]+)/i.test(cd)) {
      filename = decodeURIComponent(cd.match(/filename\*=UTF-8''([^;]+)/i)[1]);
    } else if (cd && /filename="?([^"]+)"?/i.test(cd)) {
      filename = cd.match(/filename="?([^"]+)"?/i)[1];
    }

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  }


  //
  //
  //
  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      backgroundColor: '#191919',
      color: '#e5e7eb',
      position: 'relative'
    }}>      
      {/* Sidebar */}
      <div
        style={{ 
          width: sidebarOpen ? `${SIDEBAR_WIDTH}px` : '0px',
          minWidth: sidebarOpen ? `${SIDEBAR_WIDTH}px` : '0px',
          backgroundColor: '#111111', 
          borderRight: sidebarOpen ? '1px solid #374151' : 'none',
          overflowY: 'auto',
          overflowX: 'hidden',
          transition: 'all 0.3s ease',
          position: 'relative',
          userSelect: 'none',
          WebkitUserSelect: 'none'
        }}
      >
        <div style={{ 
          width: `${SIDEBAR_WIDTH}px`,
          opacity: sidebarOpen ? 1 : 0,
          transition: 'opacity 0.3s ease',
          pointerEvents: sidebarOpen ? 'auto' : 'none'
        }}>
          {/* Logo with Close Button */}
          <div style={{
            padding: '16px 16px 16px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            {/* <img src="/chaoseater_logo.png" style={{ width: 'auto', height: '52px'}} /> */}
            <span style={{
              fontSize: '20px',
              fontWeight: '800',
              fontVariant: 'small-caps'
            }}>
              ChaosEater
            </span>

            <button
              aria-label="Close sidebar"
              onClick={() => setSidebarOpen(false)}
              title="Close sidebar"
              style={{
                marginLeft: 'auto',
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: 'transparent', // '#1f1f1f',
                border: 'none', // '1px solid #374151',
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
                e.currentTarget.style.backgroundColor = 'transparent'; //'#1f1f1f';
                e.currentTarget.style.color = '#d1d5db';
              }}
            >
              <PanelLeftClose size={20} />
            </button>
          </div>
          
          {/* New cycle row */}
          <div style={{ padding: '0 8px' }}>
            <button
              onClick={handleNewCycle}
              title="Start a new cycle (fresh session)"
              style={{
                width: '100%',
                padding: '10px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                backgroundColor: 'transparent',
                border: 'none',
                borderRadius: 8,
                color: '#e5e7eb',
                cursor: 'pointer',
                transition: 'background-color 0.2s ease, color 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#1a1a1a';
                e.currentTarget.style.color = '#84cc16';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = '#e5e7eb';
              }}
            >
              <PlusCircle size={16} />
              <span style={{ fontSize: '14px', fontWeight: 500 }}>New project</span>
            </button>
          </div>


        {/* General Settings */}
        <div style={{ padding: '0 8px' }}>
          <button
            onClick={() =>
              setSidebarCollapsed(prev => ({ ...prev, general: !prev.general }))
            }
            style={{
              width: '100%',
              padding: '10px 8px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              backgroundColor: 'transparent',
              border: 'none',
              borderRadius: 8,
              color: '#e5e7eb',
              cursor: 'pointer',
              transition: 'background-color 0.2s ease, color 0.2s ease'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.backgroundColor = '#1a1a1a';
              e.currentTarget.style.color = '#84cc16';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = '#e5e7eb';
            }}
            aria-expanded={!sidebarCollapsed.general}
            aria-controls="settings-collapse"
          >
            <Wrench size={16} />
            <span style={{ fontSize: '14px', fontWeight: '500' }}>
              Settings
            </span>
            {/* Rotate chevron with transition */}
            <span
              style={{
                gap: '8px',
                display: 'inline-flex',
                transition: 'transform 180ms ease',
                transform: sidebarCollapsed.general ? 'rotate(0deg)' : 'rotate(180deg)',
              }}
            >
              <ChevronDown size={16} />
            </span>
          </button>

          {/* Smoothly animated content */}
          <Collapse isOpen={!sidebarCollapsed.general}>
            <div id="settings-collapse" style={{
              padding: '0 16px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}>
              {/* Model Selection */}
              <div>
                <label style={{ fontSize: '12px', color: '#a9a9a9', fontWeight: '400', letterSpacing: '0.5px' }}>Model</label>
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
                  <label style={{
                    fontSize: '12px',
                    color: '#a9a9a9',
                    fontWeight: '400',
                    letterSpacing: '0.5px'
                  }}>
                    Custom model
                  </label>
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

              {/* Ollama pull progress under Custom model field */}
              {providerFromModel(formData.model) === 'ollama' && ollamaPull.model && (
                <div style={{ marginTop: '-4px', padding: 0 }}>
                  {/* Top row: text + action button horizontally aligned */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8
                  }}>
                    <div style={{ fontSize: 12, color: '#9ca3af' }}>
                      Pulling {ollamaPull.model}
                      {ollamaPull.inProgress
                        ? `… ${ollamaPull.pct != null ? `${ollamaPull.pct}%` : (ollamaPull.status || 'in progress')}`
                        : (ollamaPull.status === 'success'
                            ? ' — done'
                            : ollamaPull.status
                              ? ` — ${ollamaPull.status}`
                              : '')
                      }
                    </div>

                    {/* Action button */}
                    {ollamaPull.inProgress && (
                      <button
                        onClick={() => {
                          try { ollamaPull.abort?.abort(); } catch {}
                          setOllamaPull({
                            inProgress: false, pct: null, status: 'cancelled',
                            model: ollamaPull.model, abort: null
                          });
                          setNotification({ type: 'warning', message: 'Pull cancelled' });
                        }}
                        style={{ ...ghostButtonStyle, height: 32 }}
                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#2a2a2a'; e.currentTarget.style.color = '#84cc16'; }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#1f1f1f'; e.currentTarget.style.color = '#e5e7eb'; }}
                        title="Cancel pull"
                      >
                        Cancel
                      </button>
                    )}

                    {!ollamaPull.inProgress && ollamaPull.status === 'error' && (
                      <button
                        onClick={() => {
                          skipConfirmOnceRef.current = true;
                          const m = formData.model?.trim();
                          if (m) seenModelsRef.current.delete(m);
                          retryOllamaPull(true);
                        }} // your retry function (force = true)
                        style={{ ...ghostButtonStyle, height: 32 }}
                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#2a2a2a'; e.currentTarget.style.color = '#84cc16'; }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#1f1f1f'; e.currentTarget.style.color = '#e5e7eb'; }}
                        title="Retry pull"
                      >
                        Retry
                      </button>
                    )}
                  </div>

                  {/* Progress bar full width */}
                  <div style={{
                    width: '100%',
                    height: 6,
                    background: '#2a2a2a',
                    borderRadius: 4,
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      width: `${ollamaPull.pct ?? (ollamaPull.inProgress ? 20 : 0)}%`,
                      height: '100%',
                      background: ollamaPull.status === 'error' ? '#ef4444' : '#84cc16',
                      transition: 'width 0.2s ease'
                    }} />
                  </div>
                </div>
              )}



              {/* API Key */}
              {providerFromModel(formData.model) !== "ollama" && ( // Ollama does not require API key
                <div>
                  <label style={{ fontSize: '12px', color: '#a9a9a9', fontWeight: '400', letterSpacing: '0.5px' }}>API key</label>
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

              {/* Parameters */}
              <div>
                <label
                  style={{
                    fontSize: '12px',
                    color: '#a9a9a9',
                    fontWeight: '400',
                    letterSpacing: '0.5px'
                  }}
                >
                  Parameters
                </label>

                <div
                  style={{
                    marginTop: '8px',
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                    columnGap: '12px',
                    rowGap: '12px',
                    alignItems: 'start'
                  }}
                >
                  {/* Seed */}
                  <NumberField
                    label="Seed"
                    value={formData.seed}
                    step={1}
                    min={0}
                    onChange={(val) => setFormData(prev => ({ ...prev, seed: val }))}
                  />

                  {/* Temperature */}
                  <NumberField
                    label="Temperature"
                    value={formData.temperature}
                    step={0.1}
                    min={0}
                    max={1.0}
                    onChange={(val) => setFormData(prev => ({ ...prev, temperature: val }))}
                  />

                  {/* Maximum number of steady states */}
                  <NumberField
                    label="Max steady states"
                    value={formData.maxSteadyStates}
                    step={1}
                    min={1}
                    onChange={(val) => setFormData(prev => ({ ...prev, maxSteadyStates: val }))}
                  />

                  {/* Max retries */}
                  <NumberField
                    label="Max retries"
                    value={formData.maxRetries}
                    step={1}
                    min={0}
                    onChange={(val) => setFormData(prev => ({ ...prev, maxRetries: val }))}
                  />
                </div>
              </div>

              {/* Cluster Selection */}
              <div>
                <label style={{ fontSize: '12px', color: '#a9a9a9', fontWeight: '400', letterSpacing: '0.5px' }}>Cluster selection</label>
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
              
              <CleanClusterButton
                API_BASE={API_BASE}
                kubeContext={formData.cluster}
                namespace={'chaos-eater'}
                projectName={formData.projectName || 'chaos-eater'}
                disabled={clustersLoading}
                onNotify={(type, message) => setNotification({ type, message })}
              />
              
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
                          top: '5px', 
                          left: '4px', 
                          color: '#84cc16',
                          pointerEvents: 'none'
                        }} 
                      />
                    )}
                  </div>
                  <span style={{ fontWeight: '300' }}>Clean cluster before run</span>
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
                          top: '5px', 
                          left: '4px', 
                          color: '#84cc16',
                          pointerEvents: 'none'
                        }} 
                      />
                    )}
                  </div>
                  <span style={{ fontWeight: '300' }}>Clean cluster after run</span>
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
                          top: '5px', 
                          left: '4px', 
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
          </Collapse>
        </div>

        {/* Statics (tokens & time) */}
        <div style={{ padding: '0 8px' }}> 
          <button
            onClick={() =>
              setSidebarCollapsed(prev => ({ ...prev, usage: !prev.usage }))
            }
            style={{
              width: '100%',
              padding: '10px 8px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              backgroundColor: 'transparent',
              border: 'none',
              borderRadius: 8,
              color: '#e5e7eb',
              cursor: 'pointer',
              transition: 'background-color 0.2s ease, color 0.2s ease'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.backgroundColor = '#1a1a1a';
              e.currentTarget.style.color = '#84cc16';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = '#e5e7eb';
            }}
            aria-expanded={!sidebarCollapsed.usage}
            aria-controls="stats-collapse"
          >
            <BarChart3 size={16} />
            <span style={{ fontSize: '14px', fontWeight: '500' }}>
              Statics
            </span>
            <span
              style={{
                gap: '8px',
                display: 'inline-flex',
                transition: 'transform 180ms ease',
                transform: sidebarCollapsed.usage ? 'rotate(0deg)' : 'rotate(180deg)',
                marginLeft: '9px'
              }}
            >
              <ChevronDown size={16} />
            </span>
          </button>

          <Collapse isOpen={!sidebarCollapsed.usage}>
            <div id="stats-collapse" style={{ padding: '0 16px 16px' }}>
              <StatsPanel
                apiBase={API_BASE}
                jobId={jobId}
                snapshotKey={snapshotKey}
                collapsed={false}
              />
            </div>
          </Collapse>
        </div>

        {/* History (Snapshots) */}
        <div>
          {/* title */}
          <div style={{
            padding: '22px 16px 4px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            color: '#a9a9a9'
          }}>
            <span style={{ fontSize: '14px', fontWeight: '500', flex: 1 }}>
              History
            </span>
            <button
              onClick={handleClearAllSnapshots}
              title="Clear all snapshots"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: 6,
                backgroundColor: 'transparent',
                border: 'none',
                color: '#9ca3af',
                cursor: 'pointer',
                marginRight: '0px'
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = '#4b5563'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#9ca3af'; e.currentTarget.style.borderColor = '#374151'; }}
            >
              <Trash2 size={14} />
            </button>
          </div>
          
          {/* items */}
          <div style={{
            padding: '0 8px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '0px'
          }}>
            {snapshots.length === 0 && (
              <div style={{ color: '#6b7280', fontSize: 12, padding: '0 8px 8px' }}>No cycles yet</div>
            )}
            {snapshots.map((s) => (
              <div
                key={s.id}
                style={{ position: 'relative' }}
              >
                <button
                  onMouseEnter={() => setHoveredSnapshotId(s.id)}
                  onMouseLeave={() => setHoveredSnapshotId((prev) => (prev === s.id ? null : prev))}
                  onClick={async () => {
                    const loaded = await getSnapshot(s.id);
                    if (!loaded) return;
                    setPanelVisible(!!loaded.panelVisible);
                    setMessages(loaded.messages || []);
                    setBackendProjectPath(loaded.backendProjectPath || null);
                    setUploadedFiles((loaded.uploadedFilesMeta || []).map(m => ({ name: m.name, size: m.size, content: '' })));
                    setFormData(prev => ({ ...prev, ...(loaded.formData || {}), apiKey: '' }));
                    setCurrentSnapshotId(loaded.id);

                    // Try to restore job if it exists in snapshot but not in backend
                    let restoredJobId = loaded.jobId || null;
                    if (loaded.jobId) {
                      try {
                        // Check if job exists in backend
                        const jobResp = await fetch(`${API_BASE}/jobs/${loaded.jobId}`);
                        if (!jobResp.ok) {
                          // Job not found, try to restore from disk
                          console.log(`Job ${loaded.jobId} not found, attempting restore`);
                          let restoreResp;
                          if (loaded.jobWorkDir) {
                            // Use work_dir if available
                            restoreResp = await fetch(`${API_BASE}/jobs/restore`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ work_dir: loaded.jobWorkDir })
                            });
                          } else {
                            // Scan sandbox by job_id
                            restoreResp = await fetch(`${API_BASE}/jobs/${loaded.jobId}/restore`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' }
                            });
                          }
                          if (restoreResp.ok) {
                            const restored = await restoreResp.json();
                            restoredJobId = restored.job_id;
                            setRunState('paused');  // Job is paused and can be resumed
                            const resumePoint = restored.current_agent
                              ? `${restored.current_phase}/${restored.current_agent}`
                              : restored.current_phase;
                            setNotification({
                              type: 'success',
                              message: `Restored: ${loaded.title} (resume from ${resumePoint || 'beginning'})`
                            });
                          } else {
                            console.warn('Failed to restore job from disk');
                            restoredJobId = null;
                            setNotification({ type: 'warning', message: `Restored: ${loaded.title} (job not recoverable)` });
                          }
                        } else {
                          // Job exists, check its status
                          const job = await jobResp.json();
                          if (job.status === 'paused') {
                            setRunState('paused');
                            const resumePoint = job.current_agent
                              ? `${job.current_phase}/${job.current_agent}`
                              : job.current_phase;
                            setNotification({
                              type: 'success',
                              message: `Restored: ${loaded.title} (paused at ${resumePoint || 'unknown'})`
                            });
                          } else if (job.status === 'completed') {
                            setRunState('completed');
                            setNotification({ type: 'success', message: `Restored: ${loaded.title} (completed)` });
                          } else if (job.status === 'running') {
                            setRunState('running');
                            setNotification({ type: 'success', message: `Restored: ${loaded.title} (running)` });
                          } else {
                            setNotification({ type: 'success', message: `Restored: ${loaded.title}` });
                          }
                        }
                      } catch (err) {
                        console.error('Job restore check failed:', err);
                        restoredJobId = null;
                        setNotification({ type: 'warning', message: `Restored: ${loaded.title} (job check failed)` });
                      }
                    } else {
                      setNotification({ type: 'success', message: `Restored: ${loaded.title}` });
                    }
                    setJobId(restoredJobId);
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '3px 12px',
                    backgroundColor:
                      hoveredSnapshotId === s.id
                        ? '#1a1a1a'
                        : currentSnapshotId === s.id
                          ? '#222222'
                          : 'transparent',
                    color: hoveredSnapshotId === s.id ? '#84cc16' : '#e5e7eb',
                    border: 'none',
                    borderRadius: 8,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    transition: 'background-color 0.2s ease, color 0.2s ease',
                  }}
                  title={new Date(s.createdAt || s.updatedAt || Date.now()).toLocaleString()}
                >
                  <div style={{
                    fontSize: 14,
                    fontWeight: 600,
                    marginLeft: -4,
                    marginRight: 8,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {s.title}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setOpenMenuId(prev => prev === s.id ? null : s.id); }}
                    title="Options"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      background: 'transparent',
                      border: 'none',
                      color: '#9ca3af',
                      cursor: 'pointer',
                      marginRight: '-4px',
                      opacity: openMenuId === s.id || hoveredSnapshotId === s.id ? 1 : 0,
                      pointerEvents: openMenuId === s.id || hoveredSnapshotId === s.id ? 'auto' : 'none',
                      transition: 'opacity 0.15s ease',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#e5e7eb'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#9ca3af'; }}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </button>
            
                {openMenuId === s.id && (
                  <div
                    style={{
                      position: 'absolute', right: 12, top: 44, zIndex: 10,
                      minWidth: 160, backgroundColor: '#111827', border: '1px solid #374151',
                      borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.35)', overflow: 'hidden'
                    }}
                  >
                    <button
                      onClick={() => handleRenameSnapshot(s.id, s.title)}
                      style={{ width: '100%', padding: '8px 10px', background: 'transparent', border: 'none', color: '#e5e7eb', textAlign: 'left', display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = '#1f2937'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <Edit3 size={16} /><span style={{ fontSize: 13 }}>Rename</span>
                    </button>
                    <button
                      onClick={() => handleDeleteSnapshot(s.id)}
                      style={{ width: '100%', padding: '8px 10px', background: 'transparent', border: 'none', color: '#ef4444', textAlign: 'left', display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = '#1f2937'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <Trash2 size={16} /><span style={{ fontSize: 13 }}>Delete</span>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        </div>
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
          <MessagesPanel
            messages={messages}
            showResume={runState === 'paused'}
            showNextRun={runState === 'completed'}
            onResume={handleResume}
            onDownload={() => {
              if (!jobId) return;
              const path = `/jobs/${jobId}/artifact`; 
              const filename = `artifact.zip`;
              handleDownload(path, filename);
            }}
          />
        </div>

        {/* landing image */}
        {!panelVisible && (
          <>
            {/* Landing Logo & Message */}
            <LandingLogo />
            <LandingMessage />
        
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
                onClick={() => loadExample('nginxLimited')}
                onMouseEnter={() => setHoveredExample('nginxLimited')}
                onMouseLeave={() => setHoveredExample(null)}
                style={styles.exampleCard(hoveredExample === 'nginxLimited')}
              >
                <div style={styles.exampleTitle(hoveredExample === 'nginxLimited')}>example#1:</div>
                <div style={styles.exampleDesc(hoveredExample === 'nginxLimited')}>Nginx w/ limited experiment duration</div>
              </div>

              <div
                onClick={() => loadExample('nginx')}
                onMouseEnter={() => setHoveredExample('nginx')}
                onMouseLeave={() => setHoveredExample(null)}
                style={styles.exampleCard(hoveredExample === 'nginx')}
              >
                <div style={styles.exampleTitle(hoveredExample === 'nginx')}>example#2:</div>
                <div style={styles.exampleDesc(hoveredExample === 'nginx')}>Nginx w/ detailed CE instructions</div>
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
          {draftFiles.length > 0 && (
            <div style={{ 
              marginBottom: '12px',
              padding: '12px',
              backgroundColor: '#1a1a1a',
              borderRadius: '8px',
              border: '1px solid #374151'
            }}>
              <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '10px', fontWeight: '500' }}>
                Uploaded files ({draftFiles.length}):
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {draftFiles.map((file, index) => (
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
                      onClick={() => setDraftFiles(files => files.filter((_, i) => i !== index))}
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
            <div style={{ position: 'relative' }} key={composerKey}>
              {/* Custom placeholder text positioned left aligned */}
              {!draftInstructions.trim() && (
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
                value={draftInstructions}
                onChange={(e) => setDraftInstructions(e.target.value)}
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

                {runState === 'running' ? (
                  <button
                    onClick={handleStop}
                    style={{
                      width: 32,
                      height: 32,
                      padding: 0,
                      backgroundColor: '#84cc16',
                      border: 'none',
                      borderRadius: 6,
                      color: '#000000',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease',
                      boxShadow: '0 2px 8px rgba(239, 68, 68, 0.3)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#a3d635';
                      e.currentTarget.style.transform = 'scale(1.05)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#84cc16';
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                    title="Stop"
                  >
                    <Pause size={18} strokeWidth={2} />
                  </button>
                ) : (
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
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}