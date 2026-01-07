import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChaosEaterApp from '../App';

// Mock fetch to prevent network requests
beforeEach(() => {
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ models: [] }),
  } as Response);
});

describe('App', () => {
  describe('initial render', () => {
    it('should render without crashing (no blank page)', () => {
      // This test catches errors like "ReferenceError: process is not defined"
      // which would cause a blank page in the browser
      expect(() => {
        render(<ChaosEaterApp />);
      }).not.toThrow();
    });

    it('should render main UI elements', () => {
      render(<ChaosEaterApp />);

      // Check that the main container div is present (flex container)
      const mainContainer = document.querySelector('div[style*="display: flex"]');
      expect(mainContainer).toBeInTheDocument();
    });

    it('should not have any ReferenceErrors for environment variables', () => {
      // Specifically test that import.meta.env works correctly
      // This would fail if we accidentally use process.env in Vite
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<ChaosEaterApp />);

      // Check no ReferenceError was logged
      const referenceErrors = consoleError.mock.calls.filter(
        call => call.some(arg =>
          typeof arg === 'string' && arg.includes('ReferenceError')
        )
      );
      expect(referenceErrors).toHaveLength(0);

      consoleError.mockRestore();
    });

    it('should have accessible input for sending messages', () => {
      render(<ChaosEaterApp />);

      // The textarea for input should be present
      const textarea = document.querySelector('textarea');
      expect(textarea).toBeInTheDocument();
    });
  });
});
