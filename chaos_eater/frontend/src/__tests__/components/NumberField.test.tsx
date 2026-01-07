import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NumberField from '../../components/NumberField';

describe('NumberField', () => {
  it('should render with label', () => {
    render(<NumberField label="Temperature" value={0.5} onChange={() => {}} />);
    expect(screen.getByText('Temperature')).toBeInTheDocument();
  });

  it('should render with value', () => {
    render(<NumberField label="Test" value={42} onChange={() => {}} />);
    const input = screen.getByRole('spinbutton');
    expect(input).toHaveValue(42);
  });

  it('should call onChange when value changes', () => {
    const onChange = vi.fn();
    render(<NumberField label="Test" value={5} onChange={onChange} />);

    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '10' } });

    expect(onChange).toHaveBeenCalledWith(10);
  });

  it('should increment value on plus button click', () => {
    const onChange = vi.fn();
    render(<NumberField label="Test" value={5} onChange={onChange} step={1} />);

    const incrementBtn = screen.getByLabelText('Increment');
    fireEvent.click(incrementBtn);

    expect(onChange).toHaveBeenCalledWith(6);
  });

  it('should decrement value on minus button click', () => {
    const onChange = vi.fn();
    render(<NumberField label="Test" value={5} onChange={onChange} step={1} />);

    const decrementBtn = screen.getByLabelText('Decrement');
    fireEvent.click(decrementBtn);

    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('should respect min value', () => {
    const onChange = vi.fn();
    render(<NumberField label="Test" value={0} onChange={onChange} min={0} step={1} />);

    const decrementBtn = screen.getByLabelText('Decrement');
    fireEvent.click(decrementBtn);

    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('should respect max value', () => {
    const onChange = vi.fn();
    render(<NumberField label="Test" value={10} onChange={onChange} max={10} step={1} />);

    const incrementBtn = screen.getByLabelText('Increment');
    fireEvent.click(incrementBtn);

    expect(onChange).toHaveBeenCalledWith(10);
  });

  it('should clamp input value to min/max', () => {
    const onChange = vi.fn();
    render(<NumberField label="Test" value={5} onChange={onChange} min={0} max={10} />);

    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '100' } });

    expect(onChange).toHaveBeenCalledWith(10);
  });

  it('should handle empty string input', () => {
    const onChange = vi.fn();
    render(<NumberField label="Test" value={5} onChange={onChange} />);

    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('should handle invalid input as empty string', () => {
    // Note: For <input type="number">, non-numeric input is converted to empty string by the browser
    const onChange = vi.fn();
    render(<NumberField label="Test" value={5} onChange={onChange} min={0} />);

    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: 'abc' } });

    // Browser converts 'abc' to '' for number inputs
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('should use custom step value', () => {
    const onChange = vi.fn();
    render(<NumberField label="Test" value={0} onChange={onChange} step={0.1} />);

    const incrementBtn = screen.getByLabelText('Increment');
    fireEvent.click(incrementBtn);

    expect(onChange).toHaveBeenCalledWith(0.1);
  });

  it('should change button color on hover', () => {
    render(<NumberField label="Test" value={5} onChange={() => {}} />);

    const incrementBtn = screen.getByLabelText('Increment');

    fireEvent.mouseEnter(incrementBtn);
    expect(incrementBtn).toHaveStyle({ color: 'rgb(132, 204, 22)' }); // #84cc16

    fireEvent.mouseLeave(incrementBtn);
    expect(incrementBtn).toHaveStyle({ color: 'rgb(156, 163, 175)' }); // #9ca3af
  });

  it('should render increment and decrement buttons', () => {
    render(<NumberField label="Test" value={5} onChange={() => {}} />);

    expect(screen.getByLabelText('Increment')).toBeInTheDocument();
    expect(screen.getByLabelText('Decrement')).toBeInTheDocument();
  });

  it('should have correct input attributes', () => {
    render(<NumberField label="Test" value={5} onChange={() => {}} min={0} max={100} step={5} />);

    const input = screen.getByRole('spinbutton');
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveAttribute('min', '0');
    expect(input).toHaveAttribute('max', '100');
    expect(input).toHaveAttribute('step', '5');
  });

  it('should use default min/max/step values', () => {
    render(<NumberField label="Test" value={5} onChange={() => {}} />);

    const input = screen.getByRole('spinbutton');
    expect(input).toHaveAttribute('min', '0');
    expect(input).toHaveAttribute('max', '99');
    expect(input).toHaveAttribute('step', '1');
  });
});
