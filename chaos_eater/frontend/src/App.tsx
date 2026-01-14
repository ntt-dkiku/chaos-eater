// @ts-nocheck
// TODO: Gradually add TypeScript types to this large component
// This file is in the process of being migrated to TypeScript
import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import ApprovalDialog from './components/ApprovalDialog';
import AgentSettingsDialog from './components/AgentSettingsDialog';

// API modules
import { uploadZipToBackend } from './api/uploads';
import { checkProviderStatus, saveApiKey } from './api/config';
import {
  shortOllamaName,
  verifyOllamaModelExists,
  pullOllamaModel,
  waitOllamaTag,
} from './api/ollama';
import { downloadFromApi } from './api/downloads';
import {
  createJob,
  pauseJob,
  resumeJob,
  deleteJob,
  purgeJob,
  getJob,
  restoreJob,
} from './api/jobs';
import {
  fetchClusters,
  claimCluster as claimClusterApi,
  releaseCluster as releaseClusterApi,
  releaseClusterBeacon,
} from './api/cluster';

// Custom hooks
import { useNotification } from './hooks/useNotification';

// Styles
import {
  colors,
  spacing,
  borderRadius,
  fontSize,
  buttonStyles,
  inputStyles,
  cardStyles,
  snapshotStyles,
  chipStyles,
  composerStyles,
  menuStyles,
  containerStyles,
  textStyles,
  notificationStyles,
  actionButtonStyles,
  progressStyles,
  sidebarStyles,
  mainContentStyles,
  gridStyles,
  positionStyles,
  utilityStyles,
  optionStyles,
  hoverHandlers,
  focusHandlers,
  mergeStyles,
} from './styles';

// Agent groups for interactive mode approval settings (moved outside component for default value)
const AGENT_GROUPS: Record<string, Array<{ id: string; label: string }>> = {
  preprocess: [
    { id: 'k8s_summary_agent', label: 'K8s Summary' },
    { id: 'k8s_weakness_summary_agent', label: 'Weakness Summary' },
    { id: 'k8s_app_assumption_agent', label: 'App Assumption' },
    { id: 'ce_instruct_agent', label: 'CE Instructions' },
  ],
  hypothesis: [
    { id: 'steady_state_definer', label: 'Steady State Definer' },
    { id: 'draft_agent_*', label: 'Draft Agent (per SS)' },
    { id: 'inspection_agent_*', label: 'Inspection Agent (per SS)' },
    { id: 'threshold_agent_*', label: 'Threshold Agent (per SS)' },
    { id: 'unittest_agent_*', label: 'Unittest Agent (per SS)' },
    { id: 'completion_check_agent_*', label: 'Completion Check (per SS)' },
    { id: 'fault_definer', label: 'Fault Definer' },
    { id: 'fault_scenario_agent', label: 'Fault Scenario' },
    { id: 'fault_refiner', label: 'Fault Refiner' },
  ],
  experiment_plan: [
    { id: 'experiment_plan_agent', label: 'Experiment Plan' },
    { id: 'plan2workflow_converter', label: 'Plan to Workflow' },
  ],
  experiment: [
    { id: 'experiment_runner', label: 'Experiment Runner' },
  ],
  analysis: [
    { id: 'analysis_agent', label: 'Analysis' },
  ],
  postprocess: [
    { id: 'summary_agent', label: 'Summary' },
  ],
};

// Helper to get all agent IDs for default value
const getAllAgentIds = (): string[] => Object.values(AGENT_GROUPS).flat().map(a => a.id);

export default function ChaosEaterApp() {
  // === API constants & helpers ===
  // Pick API base from window or env; fall back to localhost.
  const API_BASE =
    (typeof window !== 'undefined' && window.NEXT_PUBLIC_CE_API) ||
    import.meta.env.VITE_CE_API ||
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
    // Interactive mode settings
    executionMode: 'full-auto' as 'full-auto' | 'interactive',
    approvalAgents: getAllAgentIds(),  // Default: all agents checked
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

  // Use custom notification hook
  const { notification, visible, setNotification } = useNotification({ timeout: 10000 });
  const [hoveredExample, setHoveredExample] = useState(null);
  const fileInputRef = useRef(null);

  // Streaming/chat states
  const [messages, setMessages] = useState([]); // [{role: 'assistant'|'user', content: string}]
  const [jobId, setJobId] = useState(null);
  const wsRef = useRef(null);
  // Track current agent for tagging messages with agentId
  const currentAgentRef = useRef<string | null>(null);
  // Approval dialog state for interactive mode
  const [approvalDialog, setApprovalDialog] = useState<{
    visible: boolean;
    agentName: string;
  } | null>(null);
  // Agent settings dialog state
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
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

  // get clusters using imported API function
  const loadClusters = async () => {
    try {
      setClustersLoading(true);
      setClustersError(null);
      const data = await fetchClusters(API_BASE, sessionIdRef.current || '');
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
    const data = await claimClusterApi(API_BASE, sessionIdRef.current, preferred);
    setFormData(prev => ({ ...prev, cluster: data.cluster }));
    setNotification({ type: 'success', message: `Cluster claimed: ${data.cluster}` });
    await loadClusters();
  };

  const releaseCluster = async () => {
    try {
      await releaseClusterApi(API_BASE, sessionIdRef.current);
    } catch (_) { }
  };

  // release the cluster by closing tab or transitioning the screen
  useEffect(() => {
    const handler = () => {
      releaseClusterBeacon(API_BASE, sessionIdRef.current);
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Note: notification auto-dismiss is now handled by useNotification hook

  //----------------
  // Ollama pulling
  //----------------
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

  //----------------
  // file uploading (uploadZipToBackend is imported from ./api/uploads)
  //----------------
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
        const projectPath = await uploadZipToBackend(API_BASE, files[0]);
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

    // Send pause request using imported API
    try {
      const data = await pauseJob(API_BASE, jobId);
      setNotification({
        type: 'success',
        message: `Job paused at phase: ${data.current_phase || 'unknown'}`
      });
    } catch (error) {
      console.error('Pause failed:', error);
      const msg = error.message || '';
      if (msg.includes('404') || msg.includes('not found')) {
        setNotification({ type: 'warning', message: 'Job not found' });
      } else if (msg.includes('400') || msg.includes('not running')) {
        setNotification({
          type: 'warning',
          message: msg || 'Job may not be running or already finished'
        });
      } else {
        setNotification({
          type: 'error',
          message: 'Failed to pause job. Backend may still be processing.'
        });
      }
    }
  };

  // Send approval response to backend
  const sendApprovalResponse = async (action: 'approve' | 'retry' | 'cancel', message?: string) => {
    if (!jobId) return;
    setApprovalDialog(null);
    try {
      await fetch(`${API_BASE}/jobs/${jobId}/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, message }),
      });
    } catch (error) {
      console.error('Failed to send approval response:', error);
      setNotification({ type: 'error', message: 'Failed to send approval response' });
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
      const data = await resumeJob(API_BASE, jobId, formData.apiKey || undefined);
      const resumePoint = data.resume_from_agent
        ? `${data.resume_from}/${data.resume_from_agent}`
        : (data.resume_from || 'beginning');
      setNotification({
        type: 'success',
        message: `Resuming from: ${resumePoint}`
      });

      // Keep existing messages (completed agents' output)
      // Backend clears old events on resume, so only new events arrive
      currentAgentRef.current = null;
      partialStateRef.current = null;

      // Reconnect WebSocket for streaming
      const socket = new WebSocket(wsUrl(`/jobs/${jobId}/stream`));
      wsRef.current = socket;

      socket.onopen = () => {
        // State already cleared above
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
        await deleteJob(API_BASE, jobId);
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
    currentAgentRef.current = null;
    
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
      const body = await purgeJob(API_BASE, jid);
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
      namespace: 'chaos-eater',
      // Interactive mode settings
      execution_mode: formData.executionMode,
      approval_agents: formData.approvalAgents,
    };

    try {
      // 2. create job using imported API
      const data = await createJob(API_BASE, payload, {
        apiKey: formData.apiKey || undefined,
        model: formData.model || undefined,
      });
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

  // Uses imported checkProviderStatus from ./api/config
  async function checkProviderStatusAndSetState(model) {
    const provider = providerFromModel(model);
    if (!provider) {
      setApiKeyConfigured(false);
      return;
    }
    try {
      const configured = await checkProviderStatus(API_BASE, provider);
      setApiKeyConfigured(configured);
    } catch {
      setApiKeyConfigured(false);
    }
  }

  useEffect(() => {
    if (formData.model) {
      checkProviderStatusAndSetState(formData.model);
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

  // Uses imported saveApiKey from ./api/config
  async function saveApiKeyForCurrentModel(apiKey, model) {
    const provider = providerFromModel(model);
    if (!provider) throw new Error(`Unknown provider from model: ${model}`);
    const result = await saveApiKey(API_BASE, provider, apiKey);
    await checkProviderStatusAndSetState(model);
    return result;
  }

  //--------------
  // Ollama functions are now imported from ./api/ollama
  // (shortOllamaName, verifyOllamaModelExists, pullOllamaModel, waitOllamaTag)

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
      final = false,             // true if this partial is the last one for the bubble
      agentId = undefined        // agent ID for resume filtering
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
        // Create a new bubble with agentId for resume filtering
        out.push({
          type, // 'text' | 'code'
          role,
          content: c,
          ...(type === 'code' ? { language } : {}),
          ...(agentId ? { agentId } : {})
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
              agentId: currentAgentRef.current,
            });
            return;
          }
          if (ev.type === 'partial_end') {
            partialStateRef.current = null;
            return;
          }
          if (ev.type === 'write') {
            setMessages(m => [...m, { type: 'text', role: ev.role || 'assistant', content: ev.text || '', agentId: currentAgentRef.current }]);
            return;
          }
          if (ev.type === 'code') {
            setMessages(m => [...m, { type: 'code', role: ev.role || 'assistant', content: ev.code || '', language: ev.language, filename: ev.filename, agentId: currentAgentRef.current }]);
            return;
          }
          if (ev.type === 'subheader') {
            setMessages(m => [...m, { type: 'subheader', role: ev.role || 'assistant', content: ev.text || '', agentId: currentAgentRef.current }]);
            return;
          }
          if (ev.type === 'iframe') {
            setMessages(m => [...m, { type: 'iframe', role: ev.role || 'assistant', content: ev.url || '', agentId: currentAgentRef.current }]);
            return;
          }
          if (ev.type === 'tag') {
            setMessages(m => [...m, { type: 'tag', role: ev.role || 'assistant', content: ev.text || '', color: ev.color, background: ev.background, agentId: currentAgentRef.current }]);
            return;
          }
          // Agent tracking for resume functionality (messages are tagged with agentId)
          if (ev.type === 'agent_start') {
            currentAgentRef.current = ev.agent;
            return;
          }
          if (ev.type === 'agent_end') {
            currentAgentRef.current = null;
            return;
          }
          if (ev.type === 'resume_start') {
            // Remove incomplete output from the agent being resumed
            const agentToResume = ev.agent;
            if (agentToResume) {
              setMessages(prev => prev.filter(msg => msg.agentId !== agentToResume));
            }
            partialStateRef.current = null;
            currentAgentRef.current = null;
            return;
          }
          if (ev.type === 'approval_request') {
            const agentName = ev.agent;
            // Check if this agent needs approval based on settings
            const needsApproval = formData.approvalAgents.some(pattern => {
              if (pattern.endsWith('_*')) {
                return agentName.startsWith(pattern.slice(0, -2));
              }
              return pattern === agentName;
            });

            if (needsApproval) {
              setApprovalDialog({
                visible: true,
                agentName,
              });
            } else {
              // Auto-approve agents not in the list
              sendApprovalResponse('approve');
            }
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
            agentId: currentAgentRef.current,
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

  //
  //
  //
  return (
    <div style={containerStyles.app}>
      {/* Sidebar */}
      <div
        style={mergeStyles(containerStyles.sidebar, {
          width: sidebarOpen ? `${SIDEBAR_WIDTH}px` : '0px',
          minWidth: sidebarOpen ? `${SIDEBAR_WIDTH}px` : '0px',
          borderRight: sidebarOpen ? `1px solid ${colors.border}` : 'none',
        })}
      >
        <div style={{
          width: `${SIDEBAR_WIDTH}px`,
          opacity: sidebarOpen ? 1 : 0,
          transition: 'opacity 0.3s ease',
          pointerEvents: sidebarOpen ? 'auto' : 'none'
        }}>
          {/* Logo with Close Button */}
          <div style={sidebarStyles.logoContainer}>
            {/* <img src="/chaoseater_logo.png" style={{ width: 'auto', height: '52px'}} /> */}
            <span style={sidebarStyles.logoText}>
              ChaosEater
            </span>

            <button
              aria-label="Close sidebar"
              onClick={() => setSidebarOpen(false)}
              title="Close sidebar"
              style={mergeStyles(buttonStyles.icon, { marginLeft: 'auto' })}
              {...hoverHandlers.iconButton}
            >
              <PanelLeftClose size={20} />
            </button>
          </div>
          
          {/* New cycle row */}
          <div style={containerStyles.section}>
            <button
              onClick={handleNewCycle}
              title="Start a new cycle (fresh session)"
              style={buttonStyles.ghost}
              {...hoverHandlers.sidebarItem}
            >
              <PlusCircle size={16} />
              <span style={textStyles.sectionTitle}>New project</span>
            </button>
          </div>


        {/* General Settings */}
        <div style={containerStyles.section}>
          <button
            onClick={() =>
              setSidebarCollapsed(prev => ({ ...prev, general: !prev.general }))
            }
            style={buttonStyles.ghost}
            {...hoverHandlers.sidebarItem}
            aria-expanded={!sidebarCollapsed.general}
            aria-controls="settings-collapse"
          >
            <Wrench size={16} />
            <span style={textStyles.sectionTitle}>
              Settings
            </span>
            {/* Rotate chevron with transition */}
            <span
              style={mergeStyles(sidebarStyles.chevron, {
                transform: sidebarCollapsed.general ? 'rotate(0deg)' : 'rotate(180deg)',
              })}
            >
              <ChevronDown size={16} />
            </span>
          </button>

          {/* Smoothly animated content */}
          <Collapse isOpen={!sidebarCollapsed.general}>
            <div id="settings-collapse" style={sidebarStyles.collapseContent}>
              {/* Mode Selection - Top of Settings */}
              <div>
                <label style={inputStyles.label}>Mode</label>
                <select
                  style={mergeStyles(inputStyles.select, { marginTop: '4px' })}
                  value={formData.executionMode}
                  onChange={(e) => setFormData({...formData, executionMode: e.target.value as 'full-auto' | 'interactive'})}
                  {...focusHandlers.input}
                >
                  <option value="full-auto" style={{ backgroundColor: colors.bgInput }}>Full-Auto</option>
                  <option value="interactive" style={{ backgroundColor: colors.bgInput }}>Interactive</option>
                </select>
              </div>

              {/* Advanced Settings link (only visible in interactive mode) */}
              {formData.executionMode === 'interactive' && (
                <button
                  onClick={() => setAgentSettingsOpen(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: colors.primary,
                    fontSize: fontSize.xs,
                    cursor: 'pointer',
                    padding: 0,
                    marginTop: spacing.xs,
                    textDecoration: 'underline',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = colors.accentHover;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = colors.primary;
                  }}
                >
                  advanced settings
                </button>
              )}

              {/* Model Selection */}
              <div>
                <label style={inputStyles.label}>Model</label>
                <select
                  style={mergeStyles(inputStyles.select, { marginTop: '4px' })}
                  value={selectModelValue}
                  onChange={(e) => setFormData({...formData, model: e.target.value})}
                  {...focusHandlers.input}
                >
                  {models.map(model => (
                    <option key={model} value={model} style={{ backgroundColor: colors.bgInput, padding: '8px' }}>{model}</option>
                  ))}
                </select>
              </div>

              {selectModelValue === 'custom' && (
                <div>
                  <label style={inputStyles.label}>Custom model</label>
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
                      e.currentTarget.style.borderColor = colors.borderLight;
                    }}
                    style={mergeStyles(inputStyles.base, { marginTop: '4px', paddingRight: '36px' })}
                    onFocus={(e) => (e.currentTarget.style.borderColor = colors.border)}
                  />
                </div>
              )}

              {/* Ollama pull progress under Custom model field */}
              {providerFromModel(formData.model) === 'ollama' && ollamaPull.model && (
                <div style={utilityStyles.pullProgressWrapper}>
                  {/* Top row: text + action button horizontally aligned */}
                  <div style={progressStyles.infoRow}>
                    <div style={progressStyles.statusText}>
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
                        style={mergeStyles(buttonStyles.secondary, { height: 32 })}
                        {...hoverHandlers.ghostButton}
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
                        }}
                        style={mergeStyles(buttonStyles.secondary, { height: 32 })}
                        {...hoverHandlers.ghostButton}
                        title="Retry pull"
                      >
                        Retry
                      </button>
                    )}
                  </div>

                  {/* Progress bar full width */}
                  <div style={progressStyles.container}>
                    <div style={mergeStyles(
                      progressStyles.fill,
                      ollamaPull.status === 'error' && progressStyles.fillError,
                      { width: `${ollamaPull.pct ?? (ollamaPull.inProgress ? 20 : 0)}%` }
                    )} />
                  </div>
                </div>
              )}



              {/* API Key */}
              {providerFromModel(formData.model) !== "ollama" && ( // Ollama does not require API key
                <div>
                  <label style={inputStyles.label}>API key</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={formData.apiKeyVisible ? "text" : "password"}
                      placeholder={apiKeyConfigured ? "Your API key is already set" : "Enter your API key"}
                      style={mergeStyles(inputStyles.base, { marginTop: '4px', paddingRight: '36px' })}
                      value={formData.apiKey}
                      onChange={(e) => setFormData({...formData, apiKey: e.target.value})}
                      onFocus={(e) => e.target.style.borderColor = colors.border}
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
                        e.target.style.borderColor = colors.borderLight;
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
                      style={positionStyles.inputIconWrapper}
                      {...hoverHandlers.mutedIcon}
                    >
                      {formData.apiKeyVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              )}

              {/* Parameters */}
              <div>
                <label style={inputStyles.label}>Parameters</label>

                <div style={gridStyles.twoColumn}>
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
                <label style={inputStyles.label}>Cluster selection</label>
                <select
                  style={mergeStyles(inputStyles.select, {
                    marginTop: '4px',
                    color: formData.cluster ? colors.textPrimary : colors.textMuted,
                  })}
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
                  {...focusHandlers.input}
                  disabled={clustersLoading}
                >
                  {clustersLoading && (
                    <option value="" style={{ backgroundColor: colors.bgInput }}>
                      Loading clusters...
                    </option>
                  )}
                  {!clustersLoading && clustersError && (
                    <option value="" style={{ backgroundColor: colors.bgInput }}>
                      Failed to load clusters: {clustersError}
                    </option>
                  )}
                  {!clustersLoading && !clustersError && clusters.available.length === 0 && (
                    <option value="" style={{ backgroundColor: colors.bgInput }}>
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
              <div style={utilityStyles.checkboxColumn}>
                <label style={inputStyles.checkboxLabel}>
                  <div style={positionStyles.relative}>
                    <input
                      type="checkbox"
                      checked={formData.cleanBefore}
                      onChange={(e) => setFormData({...formData, cleanBefore: e.target.checked})}
                      style={inputStyles.checkbox}
                    />
                    {formData.cleanBefore && (
                      <CheckCircle size={14} style={inputStyles.checkboxIcon} />
                    )}
                  </div>
                  <span style={utilityStyles.lightText}>Clean cluster before run</span>
                </label>

                <label style={inputStyles.checkboxLabel}>
                  <div style={positionStyles.relative}>
                    <input
                      type="checkbox"
                      checked={formData.cleanAfter}
                      onChange={(e) => setFormData({...formData, cleanAfter: e.target.checked})}
                      style={inputStyles.checkbox}
                    />
                    {formData.cleanAfter && (
                      <CheckCircle size={14} style={inputStyles.checkboxIcon} />
                    )}
                  </div>
                  <span style={utilityStyles.lightText}>Clean cluster after run</span>
                </label>

                <label style={inputStyles.checkboxLabel}>
                  <div style={positionStyles.relative}>
                    <input
                      type="checkbox"
                      checked={formData.newDeployment}
                      onChange={(e) => setFormData({...formData, newDeployment: e.target.checked})}
                      style={inputStyles.checkbox}
                    />
                    {formData.newDeployment && (
                      <CheckCircle size={14} style={inputStyles.checkboxIcon} />
                    )}
                  </div>
                  <span style={utilityStyles.lightText}>New deployment</span>
                </label>
              </div>

            </div>
          </Collapse>
        </div>

        {/* Statics (tokens & time) */}
        <div style={containerStyles.section}>
          <button
            onClick={() =>
              setSidebarCollapsed(prev => ({ ...prev, usage: !prev.usage }))
            }
            style={buttonStyles.ghost}
            {...hoverHandlers.sidebarItem}
            aria-expanded={!sidebarCollapsed.usage}
            aria-controls="stats-collapse"
          >
            <BarChart3 size={16} />
            <span style={textStyles.sectionTitle}>
              Statics
            </span>
            <span
              style={mergeStyles(sidebarStyles.chevron, {
                transform: sidebarCollapsed.usage ? 'rotate(0deg)' : 'rotate(180deg)',
                marginLeft: '9px',
              })}
            >
              <ChevronDown size={16} />
            </span>
          </button>

          <Collapse isOpen={!sidebarCollapsed.usage}>
            <div id="stats-collapse" style={utilityStyles.statsCollapse}>
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
          <div style={sidebarStyles.sectionHeader}>
            <span style={mergeStyles(textStyles.sectionTitle, { flex: 1 })}>
              History
            </span>
            <button
              onClick={handleClearAllSnapshots}
              title="Clear all snapshots"
              style={buttonStyles.iconMedium}
              {...hoverHandlers.danger}
            >
              <Trash2 size={14} />
            </button>
          </div>

          {/* items */}
          <div style={sidebarStyles.historyList}>
            {snapshots.length === 0 && (
              <div style={sidebarStyles.emptyText}>No cycles yet</div>
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
                  style={mergeStyles(
                    snapshotStyles.item,
                    currentSnapshotId === s.id && snapshotStyles.itemSelected,
                    hoveredSnapshotId === s.id && snapshotStyles.itemHover
                  )}
                  title={new Date(s.createdAt || s.updatedAt || Date.now()).toLocaleString()}
                >
                  <div style={snapshotStyles.itemTitle}>
                    {s.title}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setOpenMenuId(prev => prev === s.id ? null : s.id); }}
                    title="Options"
                    style={mergeStyles(buttonStyles.iconMedium, {
                      color: colors.textSecondary,
                      marginRight: '-4px',
                      opacity: openMenuId === s.id || hoveredSnapshotId === s.id ? 1 : 0,
                      pointerEvents: openMenuId === s.id || hoveredSnapshotId === s.id ? 'auto' : 'none',
                      transition: 'opacity 0.15s ease',
                    })}
                    onMouseEnter={e => { e.currentTarget.style.color = colors.textPrimary; }}
                    onMouseLeave={e => { e.currentTarget.style.color = colors.textSecondary; }}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </button>
            
                {openMenuId === s.id && (
                  <div style={mergeStyles(menuStyles.dropdown, { right: 12, top: 44 })}>
                    <button
                      onClick={() => handleRenameSnapshot(s.id, s.title)}
                      style={menuStyles.item}
                      {...hoverHandlers.menuItem}
                    >
                      <Edit3 size={16} /><span>Rename</span>
                    </button>
                    <button
                      onClick={() => handleDeleteSnapshot(s.id)}
                      style={menuStyles.itemDanger}
                      {...hoverHandlers.menuItem}
                    >
                      <Trash2 size={16} /><span>Delete</span>
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
          style={mergeStyles(buttonStyles.floating, { top: '12px', left: '12px', zIndex: 1000 })}
          {...hoverHandlers.iconButton}
        >
          <PanelLeftOpen size={18} />
        </button>
      )}
      
      {/* Main Content */}
      <div style={mainContentStyles.container}>
        {/* dialog */}
        <div style={mergeStyles(mainContentStyles.dialogWrapper, {
          position: panelVisible ? 'relative' : 'absolute',
          visibility: panelVisible ? 'visible' : 'hidden',
          opacity: panelVisible ? 1 : 0,
          height: panelVisible ? 'calc(100% - 150px)' : '0',
          pointerEvents: panelVisible ? 'auto' : 'none',
        })}>
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
            <div style={utilityStyles.flexSpacer} />

            {/* Example Cards */}
            <div style={mainContentStyles.exampleGrid}>
              <div
                onClick={() => loadExample('nginxLimited')}
                onMouseEnter={() => setHoveredExample('nginxLimited')}
                onMouseLeave={() => setHoveredExample(null)}
                style={mergeStyles(cardStyles.example, hoveredExample === 'nginxLimited' && cardStyles.exampleHover)}
              >
                <div style={mergeStyles(cardStyles.exampleTitle, hoveredExample === 'nginxLimited' && cardStyles.exampleTitleHover)}>example#1:</div>
                <div style={mergeStyles(cardStyles.exampleDesc, hoveredExample === 'nginxLimited' && cardStyles.exampleDescHover)}>Nginx w/ limited experiment duration</div>
              </div>

              <div
                onClick={() => loadExample('nginx')}
                onMouseEnter={() => setHoveredExample('nginx')}
                onMouseLeave={() => setHoveredExample(null)}
                style={mergeStyles(cardStyles.example, hoveredExample === 'nginx' && cardStyles.exampleHover)}
              >
                <div style={mergeStyles(cardStyles.exampleTitle, hoveredExample === 'nginx' && cardStyles.exampleTitleHover)}>example#2:</div>
                <div style={mergeStyles(cardStyles.exampleDesc, hoveredExample === 'nginx' && cardStyles.exampleDescHover)}>Nginx w/ detailed CE instructions</div>
              </div>

              <div
                onClick={() => loadExample('sockshop')}
                onMouseEnter={() => setHoveredExample('sockshop')}
                onMouseLeave={() => setHoveredExample(null)}
                style={mergeStyles(cardStyles.example, hoveredExample === 'sockshop' && cardStyles.exampleHover)}
              >
                <div style={mergeStyles(cardStyles.exampleTitle, hoveredExample === 'sockshop' && cardStyles.exampleTitleHover)}>example#3:</div>
                <div style={mergeStyles(cardStyles.exampleDesc, hoveredExample === 'sockshop' && cardStyles.exampleDescHover)}>Sock shop w/ limited experiment duration</div>
              </div>
            </div>
          </>
        )}
        
        {/* Unified Chat Input Area */}
        <div style={mainContentStyles.chatInputWrapper}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".yaml,.yml,.zip"
            onChange={handleFileUpload}
            style={utilityStyles.hidden}
          />

          {/* Uploaded files display */}
          {draftFiles.length > 0 && (
            <div style={composerStyles.filesPreview}>
              <div style={mainContentStyles.filesLabel}>
                Uploaded files ({draftFiles.length}):
              </div>
              <div style={mainContentStyles.filesContainer}>
                {draftFiles.map((file, index) => (
                  <div key={index} style={chipStyles.file}>
                    <span style={mainContentStyles.fileName}>
                      {file.name}
                    </span>
                    <button
                      onClick={() => setDraftFiles(files => files.filter((_, i) => i !== index))}
                      style={chipStyles.closeButton}
                      {...hoverHandlers.danger}
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
            style={composerStyles.container}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = colors.accent;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = colors.border;
            }}
          >
            {/* Upper section - Text area */}
            <div style={{ position: 'relative' }} key={composerKey}>
              {/* Custom placeholder text positioned left aligned */}
              {!draftInstructions.trim() && (
                <div style={mainContentStyles.placeholder}>
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
                style={composerStyles.textarea}
                onFocus={(e) => e.target.parentElement.parentElement.style.borderColor = colors.accent}
                onBlur={(e) => e.target.parentElement.parentElement.style.borderColor = colors.border}
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
            <div style={composerStyles.controls}>
              {/* Left group */}
              <div style={composerStyles.controlGroup}>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={mergeStyles(buttonStyles.icon, { padding: 0, color: colors.textSecondary })}
                  {...hoverHandlers.iconButton}
                  title="Add files"
                >
                  <Paperclip size={18} />
                </button>
              </div>

              {/* Right group: [toast][Send] */}
              <div style={composerStyles.controlGroup}>
                {notification && (
                  <div
                    style={mergeStyles(
                      notificationStyles.base,
                      notification.type === 'error' ? notificationStyles.error : notificationStyles.success,
                      { opacity: visible ? 1 : 0 }
                    )}
                  >
                    {notification.message}
                  </div>
                )}

                {runState === 'running' ? (
                  <button
                    onClick={handleStop}
                    style={actionButtonStyles.stop}
                    {...hoverHandlers.actionButton}
                    title="Stop"
                  >
                    <Pause size={18} strokeWidth={2} />
                  </button>
                ) : (
                  <button
                    onClick={handleSubmit}
                    disabled={isLoading}
                    style={mergeStyles(
                      actionButtonStyles.send,
                      isLoading && actionButtonStyles.sendDisabled
                    )}
                    onMouseEnter={(e) => {
                      if (!isLoading) {
                        e.currentTarget.style.backgroundColor = colors.accentHover;
                        e.currentTarget.style.transform = 'scale(1.05)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = colors.accent;
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

      {/* Agent Settings Dialog for Interactive Mode */}
      <AgentSettingsDialog
        isOpen={agentSettingsOpen}
        onClose={() => setAgentSettingsOpen(false)}
        approvalAgents={formData.approvalAgents}
        onApprovalAgentsChange={(agents) => setFormData({...formData, approvalAgents: agents})}
        agentGroups={AGENT_GROUPS}
      />

      {/* Approval Dialog for Interactive Mode */}
      {approvalDialog && (
        <ApprovalDialog
          agentName={approvalDialog.agentName}
          onApprove={(message) => sendApprovalResponse('approve', message)}
          onRetry={(message) => sendApprovalResponse('retry', message)}
          onCancel={() => sendApprovalResponse('cancel')}
        />
      )}
    </div>
  );
}