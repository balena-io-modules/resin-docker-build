declare module 'duplexify' {
	interface Duplexify extends NodeJS.ReadWriteStream {
		setWritable(w: NodeJS.WritableStream): void;
		setReadable(r: NodeJS.ReadableStream): void;
		destroy(e: Error): void;
	}

	function duplexify(): Duplexify;
	export = duplexify;
}
