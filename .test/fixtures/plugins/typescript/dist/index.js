// @ts-expect-error The package is provided by the app's virtual module endpoint.
import { notyra } from "/fixture-typescript/@notyra/api.js";
export function activate() {
	const api = notyra;
	api.commands.register({
		id: "hello",
		title: "Hello from TypeScript",
		run() {}
	});
	api.styles.add(".fixture-typescript { color: blue; }");
}
export function deactivate() {}
