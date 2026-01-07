import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, ArrowDown, RotateCcw, Download } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Message } from '../types';

import msg_styles from '../MessagesPanel.module.css';

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
}

function CodeBlock({ code, language = 'text', filename }: CodeBlockProps): React.ReactElement {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed', err);
    }
  };

  return (
    <div
      style={{
        marginBottom: '1em',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {/* header (file name) */}
      {filename && (
        <div
          style={{
            background: '#111',
            color: '#9ca3af',
            fontSize: 12,
            padding: '6px 12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTopLeftRadius: 8,
            borderTopRightRadius: 8,
          }}
        >
          <span>{filename}</span>
          <button
            onClick={handleCopy}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#9ca3af',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Copy size={14} />
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}

      <div
        style={{
          width: '100%',
          maxWidth: '768px',
          minWidth: 0,
          overflowX: 'auto',
          contain: 'inline-size',
        }}
      >
        <SyntaxHighlighter
          language={language}
          style={oneDark}
          customStyle={{
            margin: 0,
            borderRadius: filename ? '0 0 8px 8px' : '8px',
            maxWidth: '768px',
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

export interface MessagesPanelProps {
  messages: Message[];
  showResume?: boolean;
  showNextRun?: boolean;
  onResume?: () => void;
  onDownload?: () => void;
}

export default function MessagesPanel({
  messages,
  showResume = false,
  showNextRun = false,
  onResume,
  onDownload,
}: MessagesPanelProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomElRef = useRef<HTMLDivElement>(null);

  const [autoScroll, setAutoScroll] = useState(true);
  const isFirstMount = useRef(true);
  const prevMessageCount = useRef(0);

  // Ensure IntersectionObserver root is set after mount
  const [ioRoot, setIoRoot] = useState<Element | null>(null);
  useEffect(() => {
    setIoRoot(containerRef.current);
  }, []);

  // Observe the bottom sentinel element
  const { ref: setBottomRef, inView: isBottomVisible } = useInView({
    threshold: 0,
    root: ioRoot,
    rootMargin: '0px 0px 56px 0px', // Treat as "at bottom" if within 56px
  });

  // Attach both: actual ref and useInView's ref
  const attachBottom = (node: HTMLDivElement | null): void => {
    bottomElRef.current = node;
    setBottomRef(node);
  };

  // Common scroll-to-bottom helper
  const scrollToBottom = (smooth = false): void => {
    if (bottomElRef.current) {
      bottomElRef.current.scrollIntoView({
        behavior: smooth ? 'smooth' : 'auto',
        block: 'end',
      });
    } else if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  };

  // Update autoScroll when scroll position changes
  useEffect(() => {
    // Skip on first mount
    if (isFirstMount.current) return;
    setAutoScroll(isBottomVisible);
  }, [isBottomVisible]);

  // Scroll to bottom on first mount
  useLayoutEffect(() => {
    if (!isFirstMount.current) return;
    isFirstMount.current = false;
    prevMessageCount.current = messages.length;
    if (messages.length > 0) scrollToBottom(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll only when new messages arrive
  useEffect(() => {
    // Auto-scroll only when the number of messages increases
    if (messages.length > prevMessageCount.current && autoScroll) {
      scrollToBottom(true);
    }
    prevMessageCount.current = messages.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, autoScroll]);

  // Watch for content height changes (e.g. lines growing inside existing message)
  useEffect(() => {
    if (!contentRef.current) return;
    const ro = new ResizeObserver(() => {
      if (autoScroll) scrollToBottom(true);
    });
    ro.observe(contentRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScroll]);

  // Handler for "Jump to bottom" button
  const jumpToBottom = (): void => {
    scrollToBottom(true);
    setAutoScroll(true);
  };

  const renderMsg = (m: Message, i: number): React.ReactNode => {
    const type = m.type || 'text';
    const roleColor = m.role === 'user' ? '#84cc16' : '#e5e7eb';
    const roleBorder = m.role === 'user' ? '1px solid #374151' : 'none';

    if (type === 'subheader') {
      return (
        <div key={i} className={msg_styles.subheader}>
          {m.content}
        </div>
      );
    }
    if (type === 'code') {
      return (
        <div key={i} style={{ width: '100%', minWidth: 0 }}>
          <CodeBlock
            code={m.content}
            language={(m as { language?: string }).language}
            filename={(m as { filename?: string }).filename}
          />
        </div>
      );
    }
    if (type === 'status') return null;
    if (type === 'iframe') {
      const url = String(m.content || '').trim();
      const isSafe = /^https:\/\//i.test(url) || /^http:\/\/localhost(:\d+)?/i.test(url);

      if (!isSafe) {
        return (
          <div key={i} style={{ color: '#fca5a5', fontSize: 12, margin: '6px 0' }}>
            Invalid iframe URL
          </div>
        );
      }

      return (
        <div key={i} style={{ width: '100%', minWidth: 0, margin: '8px 0' }}>
          <div
            style={{
              position: 'relative',
              width: '100%',
              paddingTop: '56.25%', // 16:9
              border: '1px solid #374151',
              borderRadius: 8,
              overflow: 'hidden',
              background: '#0b0b0b',
            }}
          >
            <iframe
              src={url}
              title={(m as { title?: string }).title || 'Embedded content'}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                border: '0',
              }}
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
      );
    }
    if (type === 'tag') {
      return (
        <span
          key={i}
          style={{
            color: (m as { color?: string }).color,
            backgroundColor: (m as { background?: string }).background,
            padding: '2px 6px',
            borderRadius: '4px',
          }}
        >
          {m.content}
        </span>
      );
    }

    return (
      <div
        key={i}
        style={{
          margin: '6px 0',
          color: roleColor,
          border: roleBorder,
          borderRadius: m.role === 'user' ? 6 : 0,
          padding: m.role === 'user' ? '6px 10px' : '0',
          backgroundColor: m.role === 'user' ? '#1f1f1f' : 'transparent',
          whiteSpace: 'normal',
          wordBreak: 'break-word',
        }}
      >
        <ReactMarkdown
          className="markdown-body"
          remarkPlugins={[remarkGfm]}
          components={{
            a({ ...props }) {
              return <a {...props} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa' }} />;
            },
            code({ inline, className, children, ...props }) {
              // Inline code → keep default <code>
              if (inline) {
                return (
                  <code className="md-inline-code" {...props}>
                    {children}
                  </code>
                );
              }

              // --- Block code path ---
              const langFromClass =
                typeof className === 'string' ? className.replace(/^language-/, '') : undefined;
              const language = langFromClass || 'text';

              // 3) code string (strip the trailing newline ReactMarkdown adds)
              const raw = String(children);
              const code = raw.replace(/\n$/, '');

              // inline
              const isSingleLine = !raw.includes('\n');
              const hasLanguage = !!langFromClass;
              if (!hasLanguage && isSingleLine) {
                return (
                  <code className="md-inline-code" {...props}>
                    {code}
                  </code>
                );
              }

              return <CodeBlock code={code} language={language} />;
            },
          }}
        >
          {m.content}
        </ReactMarkdown>
      </div>
    );
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.currentTarget.style.backgroundColor = '#2a2a2a';
    e.currentTarget.style.color = '#84cc16';
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.currentTarget.style.backgroundColor = '#1f1f1f';
    e.currentTarget.style.color = '#e5e7eb';
  };

  return (
    <div ref={containerRef} className={msg_styles.container}>
      <div ref={contentRef}>
        {messages.length === 0 ? <div /> : messages.map(renderMsg)}

        {/* download & resume buttons */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            flexWrap: 'wrap',
            marginTop: 12,
            marginBottom: 12,
            paddingRight: 0,
          }}
        >
          {/* artifact download */}
          {(showResume || showNextRun) && (
            <button
              onClick={onDownload}
              title="Download artifact"
              style={{
                padding: '6px 10px',
                backgroundColor: '#1f1f1f',
                border: '1px solid #374151',
                color: '#e5e7eb',
                borderRadius: 6,
                fontSize: 13,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              <Download size={16} />
              <span>Artifact</span>
            </button>
          )}

          {/* Resume button - placed after messages */}
          {showResume && (
            <button
              onClick={onResume}
              title="Resume cycle"
              aria-label="Resume"
              style={{
                padding: '6px 10px',
                backgroundColor: '#1f1f1f',
                border: '1px solid #374151',
                color: '#e5e7eb',
                borderRadius: 6,
                fontSize: 13,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              <RotateCcw size={16} />
              Resume
            </button>
          )}

          {/* Next run button */}
          {showNextRun && (
            <button
              onClick={onResume}
              title="Run next cycle"
              aria-label="Next Cycle"
              style={{
                padding: '6px 10px',
                backgroundColor: '#1f1f1f',
                border: '1px solid #374151',
                color: '#e5e7eb',
                borderRadius: 6,
                fontSize: 13,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              Next Cycle
            </button>
          )}
        </div>

        {/* Sentinel element for Intersection Observer */}
        <div ref={attachBottom} style={{ height: 1 }} />
      </div>

      {/* Jump to bottom button */}
      {!isBottomVisible && messages.length > 0 && (
        <button
          className={msg_styles.jumpBtn}
          onClick={jumpToBottom}
          aria-label="Jump to bottom"
          title="Scroll to bottom"
        >
          <ArrowDown size={20} />
        </button>
      )}
    </div>
  );
}
