import { HypermediaElectron } from './main/HypermediaElectron';

export { HypermediaElectron };
export * from './main/types';

/**
 * Factory function to create an HypermediaElectron instance
 */
export function createSSR(options = {}) {
	return new HypermediaElectron(options);
}

export default {
	HypermediaElectron,
	createSSR
}; 
