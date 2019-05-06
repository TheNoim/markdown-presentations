const {
	readdir,
	readJSON,
	ensureDir,
	readFile: readFileA,
	writeFile,
	exists,
	lstat
} = require('fs-extra');
const { join, basename } = require('path');
const { defaultsDeep, template, get } = require('lodash');
const cheerio = require('cheerio');
const fg = require('fast-glob');
const nanoid = require('nanoid');
const { dd } = require('dumper.js');
const Bundler = require('parcel-bundler');
const fm = require('front-matter');
const showdown = require('showdown');
const converter = new showdown.Converter({
	parseImgDimensions: true,
	simplifiedAutoLink: true,
	strikethrough: true,
	tables: true,
	tasklists: true,
	openLinksInNewWindow: true,
	backslashEscapesHTMLTags: true,
	emoji: true
});

const readFile = async (...args) => {
	const content = await readFileA(...args);
	return content.toString();
};

(async () => {
	const projects = await readdir('./src/');

	const projectsDir = join(__dirname, './src/');

	const tmpDir = join(__dirname, './tmp');

	const distDir = join(__dirname, './dist');

	await ensureDir(distDir);

	const projectList = [];

	const cssPath = join(__dirname, './base/index.css');
	const jsPath = join(__dirname, './base/index.js');
	const htmlPath = join(__dirname, './base/index.html');

	const cssTemplateSrc = await readFile(cssPath);
	const jsTemplateSrc = await readFile(jsPath);
	const htmlTemplateSrc = await readFile(htmlPath);

	const cssTemplate = template(cssTemplateSrc);
	const jsTemplate = template(jsTemplateSrc);
	const htmlTemplate = template(htmlTemplateSrc);

	for (const project of projects) {
		const projectTmp = join(tmpDir, project);
		const projectDir = join(projectsDir, project);

		const stat = await lstat(projectDir);

		if (!stat.isDirectory()) continue;

		const projectDistDir = join(distDir, project);
		const projectSlidesDir = join(projectDir, './slides/');
		const projectNotesDir = join(projectDir, './notes/');
		const projectConfig = join(projectDir, './config.json');
		const projectCSSPath = join(projectTmp, './index.css');
		const projectJSPath = join(projectTmp, './index.js');
		const projectHTMLPath = join(projectTmp, './index.html');
		const configSrc =
			(await readJSON(projectConfig, { throws: false })) || {};
		const config = defaultsDeep(configSrc, {
			title: 'No title',
			date: new Date(),
			remote: 'https://remote.noim.io/'
		});

		await ensureDir(projectTmp);

		const projectCSS = cssTemplate(config);

		await writeFile(projectCSSPath, projectCSS);

		const projectJS = jsTemplate(config);

		await writeFile(projectJSPath, projectJS);

		const html = htmlTemplate(config);

		const $ = cheerio.load(html);

		// Add slides

		const slidePaths = await fg.async([
			join(projectSlidesDir, './**/*.md')
		]);

		let slides = [];

		for (const slidePath of slidePaths) {
			const slideId = nanoid();
			const slidePathName = basename(slidePath);
			const slideContentOrg = await readFile(slidePath);
			const { attributes: metaSrc, body: slideContent } = fm(
				slideContentOrg
			);
			const notesFileName = get(metaSrc, 'notes', slidePathName);
			const meta = defaultsDeep(metaSrc, {
				notes: notesFileName
			});
			const safeNotesFileName = get(meta, 'notes');
			const notesPath = join(projectNotesDir, `./${safeNotesFileName}`);

			let slideObject = {
				slideContent,
				meta,
				slideId
			};

			if (await exists(notesPath)) {
				const notesContentOrg = await readFile(notesPath);
				const { attributes: notesMeta, body: notesContent } = fm(
					notesContentOrg
				);
				slideObject = {
					...slideObject,
					notesContent,
					notesMeta
				};
			}

			slides.push(slideObject);
		}

		// Find Sub Slides

		const removeIds = [];

		let slideParents = {};

		for (const slide of slides) {
			const slideNumber = get(slide, 'meta.slide', 999999);
			const slideId = get(slide, 'slideId');
			if (isDecimal(slideNumber)) {
				// This is a child
				removeIds.push(slideId);
				const parentSlideId = Math.floor(slideNumber);
				if (!slideParents[parentSlideId])
					slideParents[parentSlideId] = [];
				const newSlideNumber = getDecimalPointsAsNumber(slideNumber);
				const newSlideObject = defaultsDeep(
					{
						meta: {
							slide: newSlideNumber
						}
					},
					slide
				);
				slideParents[parentSlideId].push(newSlideObject);
			}
		}

		slides = slides.filter(slide => {
			const slideId = get(slide, 'slideId');
			return !removeIds.includes(slideId);
		});

		for (const ParentSlideId in slideParents) {
			if (!slideParents.hasOwnProperty(ParentSlideId)) continue;
			const children = slideParents[ParentSlideId];
			const slideId = nanoid();
			children.sort((a, b) => {
				const slideA = get(a, 'meta.slide', 999999);
				const slideB = get(b, 'meta.slide', 999999);
				return slideB - slideA; // Because we will insert every slide befor the password slide
			});
			slides.push({
				meta: {
					slide: parseInt(ParentSlideId)
				},
				children,
				slideId,
				parent: true
			});
		}

		// Sort slides first

		slides.sort((a, b) => {
			const slideA = get(a, 'meta.slide', 999999);
			const slideB = get(b, 'meta.slide', 999999);
			return slideB - slideA; // Because we will insert every slide befor the password slide
		});

		const passwordSlide = $('#passwordSlide');

		for (const slide of slides) {
			const slideId = get(slide, 'slideId');
			const slideSelector = `#${slideId}`;

			$(`<section id="${slideId}"></section>`).insertAfter(passwordSlide);

			if (!slide.parent) {
				generateSection(slide, $);
			} else {
				const children = get(slide, 'children', []);
				for (const child of children) {
					const childSlideId = get(child, 'slideId');
					$(`<section id="${childSlideId}"></section>`).prependTo(
						$(slideSelector)
					);
					generateSection(child, $);
					$(`#${childSlideId}`).removeAttr('id');
				}
			}

			$(`#${slideId}`).removeAttr('id');
		}

		const $comments = $('*')
			.contents()
			.filter(function() {
				return this.nodeType === 8;
			});

		$comments.each(function() {
			const self = $(this);
			let parent;
			if (self.prev().length > 0) {
				parent = self.prev();
			} else {
				parent = self.parent();
			}
			/**
			 * @type {string}
			 */
			const data = this.data;
			if (data && data.includes('.mod:')) {
				// Mod the parent thing
				const attrs = data.replace(/(\s)?\.mod:(\s)?/gm, '');
				const attrObjects = $(`<div ${attrs}></div>`)
					.first()
					.attr();
				for (const Key in attrObjects) {
					parent.attr(Key, attrObjects[Key]);
				}
				self.remove();
			}
		});

		const projectHTML = $.html();

		await writeFile(projectHTMLPath, projectHTML);

		await ensureDir(projectDistDir);

		const bundler = new Bundler(projectHTMLPath, {
			publicUrl: './',
			outDir: projectDistDir,
			watch: false,
			bundleNodeModules: true
		});

		await bundler.bundle();

		projectList.push({
			path: project,
			config
		});
	}
})();

function generateSection(slide, $) {
	const slideId = get(slide, 'slideId');
	const slideSelector = `#${slideId}`;
	const title = get(slide, 'meta.title');
	$(slideSelector).attr('title', title);
	let notesContent = get(slide, 'notesContent', false);
	const slideContent = get(slide, 'slideContent', '');
	const slideContentId = nanoid();
	$(slideSelector).html(converter.makeHtml(slideContent));

	if (!notesContent) {
		notesContent = slideContent;
	}

	const notesContentId = nanoid();
	$(`<aside class="notes" id="${notesContentId}"></aside>`).appendTo(
		$(slideSelector)
	);
	$(`#${notesContentId}`).html(converter.makeHtml(notesContent));
	$(`#${notesContentId}`).removeAttr('id');

	$(`#${slideContentId}`).removeAttr('id');
}

function isDecimal(number) {
	return number % 1 != 0;
}

function getDecimalPointsAsNumber(number) {
	const diff = `${number}`.split('.')[1];
	return parseInt(diff);
}
