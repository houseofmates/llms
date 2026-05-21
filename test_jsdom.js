const { JSDOM } = require("jsdom");
const fs = require("fs");

const html = fs.readFileSync("index.html", "utf-8");
const js = fs.readFileSync("script.js", "utf-8");

const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost" });

dom.window.onerror = function(msg, url, line, col, error) {
    console.log("Error occurred:", msg, "at line", line, col, error ? error.stack : '');
};
dom.window.addEventListener('unhandledrejection', (event) => {
    console.log("Unhandled Promise Rejection:", event.reason ? event.reason.stack : event.reason);
});

const scriptEl = dom.window.document.createElement("script");
scriptEl.textContent = js;
dom.window.document.body.appendChild(scriptEl);

dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
dom.window.dispatchEvent(new dom.window.Event("load"));

setTimeout(() => {
    console.log("Done");
}, 1000);
