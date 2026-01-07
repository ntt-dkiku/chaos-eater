import React, { useState } from 'react';
import { cleanCluster } from '../api/cluster';
import type { NotifyFn } from '../types';

export interface CleanClusterButtonProps {
  API_BASE: string;
  kubeContext: string | null;
  namespace?: string;
  projectName?: string;
  onNotify?: NotifyFn;
  disabled?: boolean;
}

export default function CleanClusterButton({
  API_BASE,
  kubeContext,
  namespace = 'chaos-eater',
  projectName = 'chaos-project',
  onNotify,
  disabled = false,
}: CleanClusterButtonProps): React.ReactElement {
  const [cleaning, setCleaning] = useState(false);

  const handleClick = async (): Promise<void> => {
    if (!kubeContext) {
      onNotify?.('error', 'Please select a cluster');
      return;
    }
    try {
      setCleaning(true);
      await cleanCluster(API_BASE, {
        kube_context: kubeContext,
        namespace,
        project_name: projectName,
      });
      onNotify?.('success', 'Cluster cleaned');
    } catch (e) {
      const error = e as Error;
      onNotify?.('error', error.message || 'Clean failed');
    } finally {
      setCleaning(false);
    }
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>): void => {
    if (!(disabled || cleaning)) {
      e.currentTarget.style.backgroundColor = '#2a2a2a';
      e.currentTarget.style.color = '#84cc16';
    }
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.currentTarget.style.backgroundColor = '#1f1f1f';
    e.currentTarget.style.color = '#e5e7eb';
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
        cursor: disabled || cleaning ? 'not-allowed' : 'pointer',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
        transition: 'all 0.2s ease',
        opacity: disabled || cleaning ? 0.6 : 1,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      Clean cluster
    </button>
  );
}
