import { describe, it, expect } from '@jest/globals';
import { bpsToDecimal, decimalToBps, calculateTakerFee, formatPrice, formatUSDC } from '@space/shared';
import BN from 'bn.js';

describe('Utility Functions', () => {
  it('should convert basis points to decimal', () => {
    expect(bpsToDecimal(new BN(5000))).toBe(0.5);
    expect(bpsToDecimal(new BN(10000))).toBe(1.0);
    expect(bpsToDecimal(new BN(2500))).toBe(0.25);
  });

  it('should convert decimal to basis points', () => {
    expect(decimalToBps(0.5).toNumber()).toBe(5000);
    expect(decimalToBps(1.0).toNumber()).toBe(10000);
    expect(decimalToBps(0.25).toNumber()).toBe(2500);
  });

  it('should calculate taker fee', () => {
    const orderSize = new BN(1000000); // 1 USDC
    const totalVolume = new BN(100000000); // 100 USDC
    
    const fee = calculateTakerFee(orderSize, totalVolume);
    expect(fee.toNumber()).toBeGreaterThanOrEqual(2);
    expect(fee.toNumber()).toBeLessThanOrEqual(200);
  });

  it('should format price', () => {
    expect(formatPrice(new BN(5000))).toBe('50.00%');
    expect(formatPrice(new BN(7500))).toBe('75.00%');
  });

  it('should format USDC', () => {
    expect(formatUSDC(new BN(1000000))).toBe('1.00');
    expect(formatUSDC(new BN(1500000))).toBe('1.50');
  });
});






