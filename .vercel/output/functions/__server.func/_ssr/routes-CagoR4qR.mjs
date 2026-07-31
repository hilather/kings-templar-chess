import { g as require_jsx_runtime, h as ClientOnly } from "../_libs/@tanstack/react-router+[...].mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-CagoR4qR.js
var import_jsx_runtime = require_jsx_runtime();
function HomePage() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ClientOnly, { fallback: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(GameShellFallback, {}) });
}
function GameShellFallback() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "min-h-full flex items-center justify-center bg-bg text-muted text-sm",
		children: "Loading Templar Chess…"
	});
}
//#endregion
export { HomePage as component };
