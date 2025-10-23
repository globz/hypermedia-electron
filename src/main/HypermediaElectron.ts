import { Protocol, protocol as electronProtocol, app } from 'electron';
import { PassThrough, Readable } from 'stream';
import {
	HypermediaElectronOptions,
	RouteHandler,
	Method,
	SSEConnection
} from './types';

/**
 * HypermediaElectron - A bridge for SSR-like functionality in Electron
 */
export class HypermediaElectron {
	private options: HypermediaElectronOptions;
	private initialized: boolean = false;
	private routes: Map<string, RouteHandler> = new Map();
	private dynamicRoutes: Map<string, { prefix: string; handler: RouteHandler }> = new Map();
	private _sseConnections: Set<SSEConnection> = new Set();
	private schemesRegistered: boolean = false;

	/**
	 * Create a new HypermediaElectron instance
	 */
	constructor(options: HypermediaElectronOptions = {}) {
		this.options = {
			debug: false,
			httpScheme: 'http',
			sseScheme: 'sse',
			...options
		};

		// Automatically register schemes when instance is created
		this.registerSchemes();

		// Register cleanup handler
		app.on('will-quit', () => {
			this.log('Auto cleanup triggered by app will-quit event');
			this.cleanup();
		});

		// Automatically register handlers when app is ready
		if (app.isReady()) {
			this.registerHandlers();
		} else {
			app.whenReady().then(() => {
				this.registerHandlers();
			});
		}
	}

	/**
	 * Get the active SSE connections
	 */
	public get sseConnections(): Set<SSEConnection> {
		return this._sseConnections;
	}

	/**
	 * Log debug messages if debug is enabled
	 */
	private log(...args: any[]): void {
		if (this.options.debug) {
			console.log('[HypermediaElectron]', ...args);
		}
	}

	/**
	 * Register protocol schemes - MUST be called BEFORE app is ready
	 */
	public registerSchemes(customProtocol?: Protocol): HypermediaElectron {
		if (this.schemesRegistered) {
			this.log('Schemes already registered');
			return this;
		}

		const { httpScheme, sseScheme } = this.options;
		const protocolToUse = customProtocol || electronProtocol;

		this.log('Registering protocol schemes');

		// Register HTTP and SSE protocol handlers
		protocolToUse.registerSchemesAsPrivileged([
			{
				scheme: httpScheme!,
				privileges: {
					standard: true,
					secure: true,
					supportFetchAPI: true,
					corsEnabled: true,
					stream: true,
				},
			},
			{
				scheme: sseScheme!,
				privileges: {
					standard: true,
					secure: true,
					supportFetchAPI: true,
					corsEnabled: true,
					stream: true,
				},
			}
		]);

		this.schemesRegistered = true;
		this.log('Protocol schemes registered');

		return this;
	}

	/**
	 * Register protocol handlers - MUST be called AFTER app is ready
	 */
	public registerHandlers(customProtocol?: Protocol): HypermediaElectron {
		if (this.initialized) {
			this.log('Handlers already registered');
			return this;
		}

		if (!this.schemesRegistered) {
			this.log('Warning: registerSchemes must be called before app is ready');
		}

		const { httpScheme, sseScheme } = this.options;
		const protocolToUse = customProtocol || electronProtocol;

		this.log('Registering protocol handlers');

		// Set up protocol handlers
		protocolToUse.handle(httpScheme!, this.handleHTTP.bind(this));
		protocolToUse.handle(sseScheme!, this.handleSSE.bind(this));

		this.initialized = true;
		this.log('Protocol handlers registered');

		return this;
	}

	/**
	 * Register a route for HTTP requests
	 */
	public registerRoute(path: string, handler: RouteHandler, method: Method = 'GET'): HypermediaElectron {
		const routeKey = `${method.toUpperCase()}:${path}`;
		this.routes.set(routeKey, handler);
		this.log(`Registered route: ${routeKey}`);
		return this;
	}

	/**
	 * Register a dynamic route with a catch-all pattern (e.g., /endpoint/*)
	 */
	public registerDynamicRoute(path: string, handler: RouteHandler, method: Method = 'GET'): HypermediaElectron {
		if (!path.endsWith('/*')) {
			throw new Error('Dynamic routes must end with /* (e.g., /endpoint/*)');
		}

		const prefix = path.slice(0, -2).replace(/\/+$/, ''); // Remove '/*' and trailing slashes
		const dynamicKey = `${method.toUpperCase()}:${prefix}:dynamic`;

		this.dynamicRoutes.set(dynamicKey, { prefix, handler });
		this.log(`Registered dynamic route: ${dynamicKey} (prefix: ${prefix})`);
		return this;
	}

	/**
	 * Broadcast content to all connected SSE clients
	 */
	public broadcastContent(eventName: string, content: string): HypermediaElectron {
		if (this._sseConnections.size === 0) {
			return this;
		}

		// Format content for SSE
		const formattedContent = content
			.split('\n')
			.map(line => `data: ${line}`)
			.join('\n');

		for (const connection of this._sseConnections) {
			if (!connection.stream.destroyed) {
				connection.stream.write(`event: ${eventName}\n${formattedContent}\n\n`);
			}
		}

		this.log(`Broadcasted content to ${this._sseConnections.size} connections`);
		return this;
	}

	/**
	 * Handle HTTP requests
	 */
	private async handleHTTP(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const method = request.method;
		const pathname = url.pathname.replace(/\/+$/, '') || '/'; // Normalize: strip trailing slashes, default to '/'

		this.log(`HTTP ${method} request for ${url.pathname}`);

		// Check if we have a registered route handler for exact match routes
		const exactKey = `${method}:${pathname}`;
		if (this.routes.has(exactKey)) {
			try {
				const handler = this.routes.get(exactKey)!;
				return await handler(request, url);
			} catch (error) {
				this.log('Error handling route:', error);
				return new Response(`Server Error: ${(error as Error).message}`, { status: 500 });
			}
		}

		// Check if we have a registered route handler for dynamic routes
		for (const [dynamicKey, { prefix, handler }] of this.dynamicRoutes.entries()) {
			if (dynamicKey.startsWith(`${method}:`) && (pathname === prefix || pathname.startsWith(prefix + '/'))) {
				try {
					const dynamicPath = pathname === prefix ? '' : pathname.slice(prefix.length + 1); // Extract part after prefix
					return await handler(request, url, dynamicPath);
				} catch (error) {
					this.log(`Error handling dynamic route ${prefix}:`, error);
					return new Response(`Server Error: ${(error as Error).message}`, { status: 500 });
				}
			}
		}

		// Return 404 for unhandled routes
		return new Response('Not Found', { status: 404 });
	}

	/**
	 * Handle SSE connections
	 */
	private handleSSE(request: Request): Response {
		this.log('New SSE connection');

		const stream = new PassThrough();

		// SSE headers
		const headers = new Headers({
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
			'Access-Control-Allow-Origin': '*',
		});

		// Add this connection to active connections
		const connection = { stream, request };
		this._sseConnections.add(connection);

		// Send initial connection established message
		stream.write('event: connected\ndata: {"status": "connected"}\n\n');

		// Remove connection when closed
		request.signal.addEventListener('abort', () => {
			this._sseConnections.delete(connection);
			stream.end();
			this.log('SSE connection closed, active connections:', this._sseConnections.size);
		});

		// Convert Node.js stream to web ReadableStream
		const webStream = Readable.toWeb(stream);

		// Return a standard web Response with the stream
		return new Response(webStream as unknown as BodyInit, { headers });
	}

	/**
	 * Clean up all SSE connections and resources
	 * Should be called when the app is about to quit
	 */
	public cleanup(): void {
		this.log('Cleaning up SSE connections');

		if (this._sseConnections.size > 0) {
			// Close all active SSE connections
			for (const connection of this._sseConnections) {
				if (!connection.stream.destroyed) {
					connection.stream.end();
				}
			}

			// Clear the connections set
			this._sseConnections.clear();
		}

		this.log('Cleanup complete');
	}
} 
