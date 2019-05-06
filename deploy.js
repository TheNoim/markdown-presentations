const Rsync = require('rsync');
const { exists } = require('fs-extra');
const { join } = require('path');
const argv = require('yargs')
	.option('destination', {
		alias: 'o',
		required: true
	})
	.option('server', {
		required: true,
		alias: 's'
	}).argv;

(async () => {
	const distDir = join(__dirname, './dist/');

	if (!(await exists(distDir))) process.exit(1);

	const rsync = new Rsync()
		.progress()
		.recursive()
		.update()
		.delete()
		.source(distDir)
		.destination(`${argv.server}:${argv.destination}`);

	await new Promise((resolve, reject) => {
		rsync.execute((error, code, cmd) => {
			if (error) return reject({ error, code, cmd });
			resolve();
		});
	});
})();
