export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set([]),
	mimeTypes: {},
	_: {
		client: {start:"_app/immutable/entry/start.C87DbaU_.js",app:"_app/immutable/entry/app.D4K7kpTl.js",imports:["_app/immutable/entry/start.C87DbaU_.js","_app/immutable/chunks/DfdDspcD.js","_app/immutable/chunks/BiXZIh4p.js","_app/immutable/chunks/CrRBlE2c.js","_app/immutable/entry/app.D4K7kpTl.js","_app/immutable/chunks/BiXZIh4p.js","_app/immutable/chunks/4rPYDz9Q.js","_app/immutable/chunks/3LSzzFxN.js","_app/immutable/chunks/CrRBlE2c.js","_app/immutable/chunks/BkSL99eX.js","_app/immutable/chunks/DNcou-Q8.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();

export const prerendered = new Set([]);

export const base = "";