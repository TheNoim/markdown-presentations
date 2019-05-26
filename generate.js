const {
	readdir,
	readJSON,
	ensureDir,
	readFile: readFileA,
	writeFile,
	exists,
	lstat,
	copyFile
} = require('fs-extra');
const { join, basename, relative } = require('path');
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
const { base64encode, base64decode } = require('nodejs-base64');
const hljs = require('highlight.js');

const matchHTMLTags = /<(\/)?[^\!].*?(\/)?>/gm;
const commentTags = /<!--(\s)?TAG:(\s)?\|(.*?)\|(\s)?-->/gm;
const matchMarkdownCode = /`(``)?[a-z]*\n*[\s\S]*?\n*`(``)?/gm;
const replaced = /<!REPLACED\|(.*)\|REPLACED\/>/gm;

const commentHTMLTags = input => {
	return input.replace(matchHTMLTags, m => {
		return `<!-- TAG: |${base64encode(m)}| -->`;
	});
};

const replaceMarkdownCode = input => {
	return input.replace(matchMarkdownCode, m => {
		return `<!REPLACED|${base64encode(m)}|REPLACED/>`;
	});
};

const replaceReplacedBack = input => {
	return input.replace(replaced, function(m, base64Tag) {
		return base64decode(base64Tag);
	});
};

const resolveHTMLTags = input => {
	return input.replace(commentTags, function(m, a, b, base64Tag) {
		return base64decode(base64Tag);
	});
};

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

	await ensureDir(tmpDir);

	const projectList = [];

	const cssPath = join(__dirname, './base/index.css');
	const jsPath = join(__dirname, './base/index.js');
	const htmlPath = join(__dirname, './base/index.html');
	const sassPath = join(__dirname, './base/index.scss');

	const newPreviewDataFile = join(tmpDir, './data.js');

	const previewHTMLPath = join(tmpDir, './index.html');

	const previewFiles = await fg.async([join(__dirname, './preview/**/*')]);

	for (const previewFile of previewFiles) {
		const relativePath = relative(
			join(__dirname, './preview/'),
			previewFile
		);
		const pathToTmp = join(tmpDir, relativePath);
		await copyFile(previewFile, pathToTmp);
	}

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
		const projectSASSPath = join(projectTmp, './index.scss');
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

		await copyFile(sassPath, projectSASSPath);

		const html = htmlTemplate(config);

		let $ = cheerio.load(html);

		// Add slides

		const slidePaths = await fg.async([
			join(projectSlidesDir, './**/*.md')
		]);

		let slides = [];

		for (const slidePath of slidePaths) {
			const slideId = nanoid();
			const slidePathName = basename(slidePath);
			const slideContentOrg = await pipe([
				await readFile(slidePath),
				replaceMarkdownCode,
				commentHTMLTags,
				replaceReplacedBack
			]);
			// const slideContentOrg = commentHTMLTags(await readFile(slidePath));

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
				const notesContentOrg = await pipe([
					await readFile(notesPath),
					replaceMarkdownCode,
					commentHTMLTags,
					replaceReplacedBack
				]);
				// const notesContentOrg = commentHTMLTags(
				// 	await readFile(notesPath)
				// );
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

		let projectHTML = $.html()
			.replace(/<!--(\s)*\.column(\s)*-->/gm, '<div class="column">')
			.replace(/<!--(\s)*\.\/column(\s)*-->/gm, '</div>')
			.replace(/<!--(\s)*\.div(\s)*-->/gm, '<div>')
			.replace(/<!--(\s)*\.\/div(\s)*-->/gm, '</div>');

		$ = cheerio.load(projectHTML);

		const $comments = $('*')
			.contents()
			.filter(function() {
				return this.nodeType === 8;
			});

		$comments.each(function() {
			const self = $(this);
			let parent = getParentOf(self);
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
					const currentAttr = parent.attr(Key) || '';
					parent.attr(Key, currentAttr + ' ' + attrObjects[Key]);
				}
				self.remove();
			}
		});

		$('mod').each(function() {
			const self = $(this);
			const attr = self.attr();
			let parent = getParentOf(self);
			for (const Key in attr) {
				copyKeyTo(Key, parent, self, attr);
			}
			self.remove();
		});

		$('fragment').each(function(index, item) {
			const self = $(this);
			const attr = self.attr();
			let parent = getParentOf(self);

			if (self.attr('group') !== undefined) {
				self.children('*').each(function() {
					$(this).addClass('fragment');
					if (self.attr('index')) {
						$(this).attr('data-fragment-index', self.attr('index'));
					}
					for (const Key in attr) {
						if (Key === 'index' || Key === 'group') continue;
						copyKeyTo(Key, $(this), self, attr);
					}
				});
				self.children().each(function() {
					$(this).appendTo(parent);
				});
				// self.children('*').appendTo(parent);
				// if (self.prev()) {
				// 	self.prev().remove();
				// }
				// self.remove();
			} else {
				parent.addClass('fragment');
				if (self.attr('index')) {
					parent.attr('data-fragment-index', self.attr('index'));
				}
				for (const Key in attr) {
					if (Key === 'index') continue;
					copyKeyTo(Key, parent, self, attr);
				}
				self.remove();
			}
		});

		$('table').each(function() {
			$(this).addClass('reveal');
		});

		$('text-left').each(function(i, item) {
			item.tagName = 'div';
			$(this).css('text-align', 'left');
		});

		$('text-right').each(function(i, item) {
			item.tagName = 'div';
			$(this).css('text-align', 'right');
		});

		$('code').each(function(index, element) {
			const attr = $(this).attr();
			if (attr && attr.class && typeof attr.class === 'string') {
				const classes = attr.class.split(' ');
				let lang;
				classes.map(v => {
					if (v.includes('language-')) {
						lang = v.replace(/language-/gm, '');
					}
				});
				if (lang) {
					const result = hljs.highlight(lang, $(this).text(), true);
					$(this).html(result.value);
					$(this).addClass('hljs');
				}
			}
		});

		projectHTML = $.html();

		await writeFile(projectHTMLPath, projectHTML);

		const newConfig = {
			...config,
			slides: slides.length,
			env: process.env.NODE_ENV || 'development'
		};

		const projectJS = jsTemplate(newConfig);

		await writeFile(projectJSPath, projectJS);

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
			config: newConfig
		});
	}

	const dataFile = `
	export const data = ${JSON.stringify(
		projectList.map(({ path, config }) => ({ ...config, path }))
	)}
	`;

	await writeFile(newPreviewDataFile, dataFile);

	const bundler = new Bundler(previewHTMLPath, {
		publicUrl: './',
		outDir: distDir,
		watch: false,
		bundleNodeModules: true
	});

	await bundler.bundle();
})();

function generateSection(slide, $) {
	const slideId = get(slide, 'slideId');
	const slideSelector = `#${slideId}`;
	const title = get(slide, 'meta.title');
	$(slideSelector).attr('title', title);
	let notesContent = get(slide, 'notesContent', false);
	const slideContent = get(slide, 'slideContent', '');
	const slideContentId = nanoid();
	$(slideSelector).html(resolveHTMLTags(converter.makeHtml(slideContent)));

	if (!notesContent) {
		notesContent = slideContent;
	}

	const notesContentId = nanoid();
	$(`<aside class="notes" id="${notesContentId}"></aside>`).appendTo(
		$(slideSelector)
	);
	$(`#${notesContentId}`).html(
		resolveHTMLTags(converter.makeHtml(notesContent))
	);
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

async function pipe(inputArray) {
	let input = await inputArray[0];
	for (let i = 0; i < inputArray.length; i++) {
		if (i === 0) continue;
		input = await inputArray[i](input);
	}
	return input;
}

function getParentOf(self) {
	let parent;
	if (self.prev().length > 0) {
		parent = self.prev();
	} else {
		parent = self.parent();
	}
	return parent;
}

function copyKeyTo(Key, parent, self, attr) {
	switch (Key) {
		case 'class':
			const classes = attr[Key].split(' ');
			classes.forEach(cl => parent.addClass(cl));
			break;
		case 'style':
			parent.css({ ...self.css(), ...parent.css() });
			break;
		default:
			parent.attr(Key, attr[Key]);
	}
}
