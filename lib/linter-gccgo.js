'use babel';

// eslint-disable-next-line import/no-extraneous-dependencies, import/extensions
import { CompositeDisposable } from 'atom';

let helpers;

const REGEX = /.+?:(\d+):(\d+):\s(.*)/g;

const loadDeps = () => {
  if (!helpers) {
    helpers = require('atom-linter');
  }
};

const parseGccgoOutput = (output, file, editor) => {
  const messages = [];
  let match = REGEX.exec(output);
  while (match !== null) {
    const line = Number.parseInt(match[1], 10) - 1;
    const col = Number.parseInt(match[2], 10) - 2;
    messages.push({
      severity: 'error',
      excerpt: match[3],
      location: {
        file,
        position: helpers.generateRange(editor, line, col),
      },
    });
    match = REGEX.exec(output);
  }
  return messages;
};

module.exports = {
  activate() {
    this.idleCallbacks = new Set();
    let depsCallbackID;
    const installLinterGccgoDeps = () => {
      this.idleCallbacks.delete(depsCallbackID);
      if (!atom.inSpecMode()) {
        require('atom-package-deps').install('linter-gccgo');
      }
      loadDeps();
    };
    depsCallbackID = window.requestIdleCallback(installLinterGccgoDeps);
    this.idleCallbacks.add(depsCallbackID);

    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(
      atom.config.observe(
        'linter-gccgo.executablePath',
        (value) => { this.executablePath = value; },
      ),
      atom.config.observe(
        'linter-gccgo.verboseMode',
        (value) => { this.verboseMode = value; },
      ),
      atom.config.observe(
        'linter-gccgo.extraOptions',
        (value) => { this.extraOptions = value; },
      ),
    );
  },

  deactivate() {
    this.idleCallbacks.forEach((callbackID) => window.cancelIdleCallback(callbackID));
    this.idleCallbacks.clear();
    this.subscriptions.dispose();
  },

  provideLinter() {
    return {
      name: 'gccgo',
      grammarScopes: ['source.go'],
      scope: 'file',
      lintsOnChange: false,
      lint: async (editor) => {
        if (!atom.workspace.isTextEditor(editor)) {
          // If we somehow get fed an invalid TextEditor just immediately return
          return null;
        }

        const filePath = editor.getPath();
        if (!filePath) {
          return null;
        }

        loadDeps();

        const args = [];

        if (this.verboseMode) {
          args.push('-v');
        }

        args.push(filePath);

        if (this.extraOptions.length > 0) {
          args.push(this.extraOptions);
        }

        const execOptions = {
          stream: 'stderr',
          uniqueKey: `linter-gccgo::${filePath}`,
          allowEmptyStderr: true,
        };

        let output;
        try {
          output = await helpers.exec(this.executablePath, args, execOptions);
        } catch (e) {
          if (e.message === 'Process execution timed out') {
            atom.notifications.addInfo('linter-gccgo: `gccgo` timed out', {
              description: 'A timeout occured while executing `gccgo`, it could be due to lower resources '
                           + 'or a temporary overload.',
            });
          } else {
            atom.notifications.addError('linter-gccgo: Unexpected error', { description: e.message });
          }
          return null;
        }

        // Process was canceled by newer process
        if (output === null) { return null; }

        return parseGccgoOutput(output, filePath, editor);
      },
    };
  },
};
