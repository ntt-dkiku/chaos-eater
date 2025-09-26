import React, { useState } from 'react';
import { cleanCluster } from '../api/cluster';

export default function CleanClusterButton({
  API_BASE,
  kubeContext,          // = formData.cluster
  namespace = 'chaos-eater',
  projectName = 'chaos-project',
  onNotify,             // (type, message) => void
  disabled = false
}) {
  const [cleaning, setCleaning] = useState(false);

  const handleClick = async () => {
    if (!kubeContext) {
      onNotify?.('error', 'Please select a cluster');
      return;
    }
    try {
      setCleaning(true);
      await cleanCluster(API_BASE, {
        kube_context: kubeContext,
        namespace,
        project_name: projectName
      });
      onNotify?.('success', 'Cluster cleaned');
    } catch (e) {
      onNotify?.('error', e.message || 'Clean failed');
    } finally {
      setCleaning(false);
    }
  };

  return (
    <button
      title="Clean resources within the selected cluster"
      onClick={handleClick}
      disabled={disabled || cleaning}
      style={{
        padding: '10px 16px',
        backgroundColor: '#1f1f1f',
        border: '1px solid #374151',
        color: '#e5e7eb',
        borderRadius: 6,
        fontSize: 13,
        cursor: (disabled || cleaning) ? 'not-allowed' : 'pointer',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
        transition: 'all 0.2s ease',
        opacity: (disabled || cleaning) ? 0.6 : 1
      }}
      onMouseEnter={(e) => {
        if (!(disabled || cleaning)) {
          e.currentTarget.style.backgroundColor = '#2a2a2a';
          e.currentTarget.style.color = '#84cc16';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = '#1f1f1f';
        e.currentTarget.style.color = '#e5e7eb';
      }}
    >
      Clean cluster
    </button>
  );
}