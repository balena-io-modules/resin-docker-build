
// Really simple class to resolve Dockerfile.templates
export class ProjectType {

	private templateContent : string = "";

	public provideEntry(stream, header) : boolean {
		// Check if this is a file we need to be able to generate the dockerfile
		// obviously this will depend on the project type, so just support Dockerfile.template for POC
		if(header.name === './Dockerfile.template') {
			//this.templateContent = stream.read(header.size).toString();
			//console.log(this.templateContent);
			stream.on('data', (data) => {
				this.templateContent += data;
			});

			return true;
		}
		return false;
	}

	public getDockerfile() {
		// Assume nuc for the sake of simplicity and so that I can build it locally :)
		return this.templateContent
		.replace(/%%RESIN_MACHINE_NAME%%/g, 'nuc')
		.replace(/%%RESIN_ARCH%%/g, 'amd64');
	}
}
