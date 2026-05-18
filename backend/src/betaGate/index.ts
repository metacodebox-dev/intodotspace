/**
 * Beta Gate Module
 * 
 * Self-contained beta access gate system.
 * Exports service, routes, and configuration.
 */

export { getBetaGateConfig, loadBetaGateConfig, resetBetaGateConfig } from './config';
export { betaGateService } from './service';
export { betaGateRoutes } from './routes';
export { BETA_KEYS, normalizeCode, maskCode, hashIp } from './keys';
