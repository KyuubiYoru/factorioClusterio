"use strict";
const assert = require("assert").strict;
const fs = require("fs-extra");
const path = require("path");

const mock = require("../mock");
const link = require("@clusterio/lib/link");
const plugin = require("@clusterio/lib/plugin");
const errors = require("@clusterio/lib/errors");


describe("lib/plugin", function() {
	describe("class BaseInstancePlugin", function() {
		let instancePlugin;
		it("should be constructible", async function() {
			instancePlugin = new plugin.BaseInstancePlugin();
			await instancePlugin.init();
		});
		it("should define defaults for hooks", async function() {
			await instancePlugin.onMetrics();
			await instancePlugin.onStart();
			await instancePlugin.onStop();
			instancePlugin.onExit();
			await instancePlugin.onOutput({});
			instancePlugin.onMasterConnectionEvent("connect");
			await instancePlugin.onPrepareMasterDisconnect();
		});
	});

	describe("class BaseMasterPlugin", function() {
		let masterPlugin;
		it("should be constructible", async function() {
			masterPlugin = new plugin.BaseMasterPlugin();
			await masterPlugin.init();
		});
		it("should define defaults for hooks", async function() {
			await masterPlugin.onInstanceStatusChanged({}, "running", "initialized");
			await masterPlugin.onMetrics();
			await masterPlugin.onShutdown();
			masterPlugin.onSlaveConnectionEvent({}, "connect");
			await masterPlugin.onPrepareSlaveDisconnect({});
		});
	});

	describe("loadPluginInfos()", function() {
		let baseDir = path.join("temp", "test", "plugin");
		let emptyDir = path.join(baseDir, "emptyDir");
		let emptyPlugin = path.join(baseDir, "emptyPlugin");
		let testPlugin = path.join(baseDir, "testPlugin");
		let brokenPlugin = path.join(baseDir, "brokenPlugin");
		let invalidPlugin = path.join(baseDir, "invalidPlugin");
		before(async function() {
			await fs.ensureDir(emptyDir);
			await fs.ensureDir(path.join(emptyPlugin, "empty"));

			async function writePlugin(pluginPath, name, infoName = name) {
				await fs.outputFile(
					path.join(pluginPath, name, "info.js"),
					`module.exports = { name: "${infoName}" };`
				);
			}

			await writePlugin(testPlugin, "test");
			await writePlugin(brokenPlugin, "broken");
			await fs.outputFile(path.join(brokenPlugin, "broken", "info.js"), "Syntax Error");
			await writePlugin(invalidPlugin, "invalid", "wrong");
		});

		it("should return an empty array for an empty directory", async function() {
			assert.deepEqual(await plugin.loadPluginInfos(emptyDir), []);
		});
		it("should ignore plugin dirs without info module", async function() {
			assert.deepEqual(await plugin.loadPluginInfos(emptyPlugin), []);
		});
		it("should discover test plugin", async function() {
			assert.deepEqual(
				await plugin.loadPluginInfos(testPlugin),
				[{ name: "test" }]
			);
		});
		it("should reject on broken plugin", async function() {
			await assert.rejects(
				plugin.loadPluginInfos(brokenPlugin),
				{ message: "PluginError: Unexpected identifier" }
			);
		});
		it("should reject on invalid plugin", async function() {
			await assert.rejects(
				plugin.loadPluginInfos(invalidPlugin),
				{ message: `Plugin dir ${invalidPlugin}/invalid does not match the name of the plugin (wrong)` }
			);
		});

		after(async function() {
			await fs.unlink(path.join(brokenPlugin, "broken", "info.js"));
		});
	});

	describe("attachPluginMessages()", function() {
		let mockLink = new link.Link("source", "target", new mock.MockConnector());
		let mockEvent = new link.Event({ type: "test:test", links: ["target-source"] });
		it("should accept pluginInfo without messages", function() {
			plugin.attachPluginMessages(mockLink, {}, null);
		});
		it("should attach handler for the given message", function() {
			function mockEventEventHandler() { };
			plugin.attachPluginMessages(mockLink, { name: "test", messages: { mockEvent }}, { mockEventEventHandler });
			assert(mockLink._handlers.get("test:test_event"), "handler was not registered");
		});
		it("should throw if missing handler for the given message", function() {
			assert.throws(
				() => plugin.attachPluginMessages(mockLink, { name: "test", messages: { mockEvent }}, {}),
				new Error("Missing handler for test:test_event on source-target link")
			);
		});
		it("should throw if message starts with the wrong prefix", function() {
			assert.throws(
				() => plugin.attachPluginMessages(mockLink, { name: "foo", messages: { mockEvent }}, {}),
				new Error('Type of mockEvent message must start with "foo:"')
			);
		});
	});

	describe("invokeHook()", function() {
		let betaTestCalled = false;
		let plugins = new Map([
			["alpha", {
				test: async function() { },
				pass: async function(arg) { return arg; },
				error: async function() { throw new Error("Test"); },
			}],
			["beta", {
				test: async function() { betaTestCalled = true; },
				pass: async function() { },
				error: async function() { },
			}],
		]);
		it("should invoke the hook on the plugin", async function() {
			await plugin.invokeHook(plugins, "test");
			assert(betaTestCalled, "Hook was not called");
		});
		it("should pass and return args", async function() {
			let result = await plugin.invokeHook(plugins, "pass", 1234);
			assert.deepEqual(result, [1234]);
		});
		it("should ignore errors", async function() {
			await plugin.invokeHook(plugins, "error");
		});
	});
});
