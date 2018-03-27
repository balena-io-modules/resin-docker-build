declare module 'JSONStream' {
	import { ThroughStream } from 'through';

	export function parse(path?: string, map?: (value: string, path: string) => any): ThroughStream;
}
