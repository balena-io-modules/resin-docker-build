/// <reference types="node" />
export declare class ProjectType {
    private templateContent;
    provideEntry(stream: NodeJS.ReadableStream, header: any): boolean;
    getDockerfile(): string;
}
