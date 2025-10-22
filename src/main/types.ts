import { Protocol } from 'electron';
import { PassThrough } from 'stream';

/**
 * Options for configuring HypermediaElectron
 */
export interface HypermediaElectronOptions {
	/** Enable debug logging */
	debug?: boolean;
	/** Custom HTTP scheme (default: 'http') */
	httpScheme?: string;
	/** Custom SSE scheme (default: 'sse') */
	sseScheme?: string;
}

/**
 * Route handler for handling HTTP requests
 */
export type RouteHandler = (request: Request, url: URL, dynamic?: string) => Promise<Response> | Response;
export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/**
 * Action handler for processing actions
 */
export type ActionHandler = (request: Request, url: URL, body: any) => Promise<Response> | Response;

/**
 * SSE Connection interface
 */
export interface SSEConnection {
	stream: PassThrough;
	request: Request;
} 
