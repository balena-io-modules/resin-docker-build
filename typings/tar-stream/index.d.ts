declare module 'tar-stream' {
	import * as Bluebird from 'bluebird';
	import { Readable } from 'stream';

	class TarPackStream extends Readable {
		entryAsync(
			options: { name: string, size: number },
			buffer: Buffer,
		): Bluebird<void>;

		finalize(): void;
	}

	export function pack(): TarPackStream;
}
