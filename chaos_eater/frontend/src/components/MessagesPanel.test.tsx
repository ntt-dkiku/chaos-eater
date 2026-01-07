import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MessagesPanel from './MessagesPanel';
import type { Message } from '../types';

// Mock the CSS module
vi.mock('../MessagesPanel.module.css', () => ({
  default: {
    container: 'container',
    subheader: 'subheader',
    jumpBtn: 'jumpBtn',
  },
}));

// Mock react-intersection-observer
vi.mock('react-intersection-observer', () => ({
  useInView: vi.fn(() => ({
    ref: vi.fn(),
    inView: true,
  })),
}));

describe('MessagesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render empty state', () => {
    render(<MessagesPanel messages={[]} />);
    // Should render without errors
    expect(document.querySelector('.container')).toBeInTheDocument();
  });

  it('should render text messages', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];

    render(<MessagesPanel messages={messages} />);

    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });

  it('should render subheader messages', () => {
    const messages: Message[] = [{ role: 'assistant', content: 'Section Title', type: 'subheader' }];

    render(<MessagesPanel messages={messages} />);

    expect(screen.getByText('Section Title')).toBeInTheDocument();
    expect(screen.getByText('Section Title')).toHaveClass('subheader');
  });

  it('should not render status messages', () => {
    const messages: Message[] = [{ role: 'assistant', content: 'Loading...', type: 'status' }];

    render(<MessagesPanel messages={messages} />);

    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });

  it('should render code blocks', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'const x = 1;',
        type: 'code',
        language: 'javascript',
      } as Message,
    ];

    render(<MessagesPanel messages={messages} />);

    // SyntaxHighlighter breaks up code into tokens, so check for the code element
    const codeElement = document.querySelector('code.language-javascript');
    expect(codeElement).toBeInTheDocument();
    expect(codeElement?.textContent).toBe('const x = 1;');
  });

  it('should show resume button when showResume is true', () => {
    render(<MessagesPanel messages={[]} showResume={true} onResume={vi.fn()} />);

    expect(screen.getByRole('button', { name: /resume/i })).toBeInTheDocument();
  });

  it('should call onResume when resume button is clicked', () => {
    const onResume = vi.fn();
    render(<MessagesPanel messages={[]} showResume={true} onResume={onResume} />);

    const button = screen.getByRole('button', { name: /resume/i });
    fireEvent.click(button);

    expect(onResume).toHaveBeenCalled();
  });

  it('should show next cycle button when showNextRun is true', () => {
    render(<MessagesPanel messages={[]} showNextRun={true} onResume={vi.fn()} />);

    expect(screen.getByRole('button', { name: /next cycle/i })).toBeInTheDocument();
  });

  it('should show download button when showResume or showNextRun is true', () => {
    render(<MessagesPanel messages={[]} showResume={true} onDownload={vi.fn()} />);

    expect(screen.getByTitle('Download artifact')).toBeInTheDocument();
  });

  it('should call onDownload when download button is clicked', () => {
    const onDownload = vi.fn();
    render(<MessagesPanel messages={[]} showResume={true} onDownload={onDownload} />);

    const button = screen.getByTitle('Download artifact');
    fireEvent.click(button);

    expect(onDownload).toHaveBeenCalled();
  });

  it('should validate iframe URLs - allow https', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'https://example.com/video',
        type: 'iframe',
      } as Message,
    ];

    render(<MessagesPanel messages={messages} />);

    const iframe = document.querySelector('iframe');
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute('src', 'https://example.com/video');
  });

  it('should validate iframe URLs - allow localhost', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'http://localhost:3000/test',
        type: 'iframe',
      } as Message,
    ];

    render(<MessagesPanel messages={messages} />);

    const iframe = document.querySelector('iframe');
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute('src', 'http://localhost:3000/test');
  });

  it('should reject invalid iframe URLs', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'http://malicious.com/attack',
        type: 'iframe',
      } as Message,
    ];

    render(<MessagesPanel messages={messages} />);

    expect(screen.getByText('Invalid iframe URL')).toBeInTheDocument();
    expect(document.querySelector('iframe')).not.toBeInTheDocument();
  });

  it('should render tag messages with styles', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'Important',
        type: 'tag',
        color: '#ff0000',
        background: '#ffeeee',
      } as Message,
    ];

    render(<MessagesPanel messages={messages} />);

    const tag = screen.getByText('Important');
    expect(tag).toBeInTheDocument();
    expect(tag).toHaveStyle({ color: '#ff0000', backgroundColor: '#ffeeee' });
  });

  it('should apply user message styling', () => {
    const messages: Message[] = [{ role: 'user', content: 'User message' }];

    render(<MessagesPanel messages={messages} />);

    // User messages have specific styling - the wrapper div has the styling
    const messageText = screen.getByText('User message');
    const wrapper = messageText.closest('div[style*="color"]');
    expect(wrapper).toHaveStyle({
      color: 'rgb(132, 204, 22)', // #84cc16
    });
    // Check background color is set (ReactMarkdown may wrap content)
    expect(wrapper).toHaveStyle({
      backgroundColor: '#1f1f1f',
    });
  });

  it('should apply assistant message styling', () => {
    const messages: Message[] = [{ role: 'assistant', content: 'Assistant message' }];

    render(<MessagesPanel messages={messages} />);

    // Assistant messages have different styling
    const messageDiv = screen.getByText('Assistant message').closest('div');
    expect(messageDiv).toHaveStyle({
      color: 'rgb(229, 231, 235)', // #e5e7eb
    });
  });

  it('should render code block with filename', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'print("hello")',
        type: 'code',
        language: 'python',
        filename: 'hello.py',
      } as Message,
    ];

    render(<MessagesPanel messages={messages} />);

    expect(screen.getByText('hello.py')).toBeInTheDocument();
    // SyntaxHighlighter breaks up code into tokens
    const codeElement = document.querySelector('code.language-python');
    expect(codeElement).toBeInTheDocument();
    expect(codeElement?.textContent).toBe('print("hello")');
  });

  it('should have copy button for code blocks with filename', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'const x = 1;',
        type: 'code',
        language: 'javascript',
        filename: 'test.js',
      } as Message,
    ];

    render(<MessagesPanel messages={messages} />);

    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('should copy code to clipboard when copy button is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'const x = 1;',
        type: 'code',
        language: 'javascript',
        filename: 'test.js',
      } as Message,
    ];

    render(<MessagesPanel messages={messages} />);

    const copyButton = screen.getByText('Copy');
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('const x = 1;');
    });

    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument();
    });
  });

  it('should change button color on hover', () => {
    const onResume = vi.fn();
    render(<MessagesPanel messages={[]} showResume={true} onResume={onResume} />);

    const button = screen.getByRole('button', { name: /resume/i });

    fireEvent.mouseEnter(button);
    expect(button).toHaveStyle({ backgroundColor: '#2a2a2a', color: 'rgb(132, 204, 22)' });

    fireEvent.mouseLeave(button);
    expect(button).toHaveStyle({ backgroundColor: '#1f1f1f', color: 'rgb(229, 231, 235)' });
  });

  it('should render iframe with sandbox and security attributes', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'https://example.com/embed',
        type: 'iframe',
        title: 'Video Player',
      } as Message,
    ];

    render(<MessagesPanel messages={messages} />);

    const iframe = document.querySelector('iframe');
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    expect(iframe).toHaveAttribute('referrerPolicy', 'no-referrer');
    expect(iframe).toHaveAttribute('title', 'Video Player');
  });
});
