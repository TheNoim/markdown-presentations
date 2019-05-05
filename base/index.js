(function() {
	if (typeof globalThis === 'object') return;
	Object.prototype.__defineGetter__('__magic__', function() {
		return this;
	});
	__magic__.globalThis = __magic__; // lolwat
	delete Object.prototype.__magic__;
})();

const Reveal = require('reveal.js/js/reveal.js');
const { initRemoteSocket } = require('reveal-socket-remote/index');
const {defaultsDeep} = require('lodash');

globalThis.Reveal = Reveal;

require('reveal.js/plugin/markdown/marked');
require('reveal.js/plugin/markdown/markdown');
require('reveal.js/plugin/notes/notes.js');

<% if (obj.revealOptions) { %>
    const revealOptions = <%= JSON.stringify(obj.revealOptions) %>;
<% } else { %>
    const revealOptions = {};
<% } %>

Reveal.initialize(defaultsDeep(revealOptions, {
	controls: true,
	slideNumber: true,
	hash: true,
    mouseWheel: true
}));

initRemoteSocket(Reveal, "<%= obj.remote %>");