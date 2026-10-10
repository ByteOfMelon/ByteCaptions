// Only blank-line rules for now; Prettier handles the rest of the formatting.
import stylistic from '@stylistic/eslint-plugin';
import tseslint from 'typescript-eslint';

const blocks = ['if', 'for', 'while', 'do', 'switch', 'try'];

export default tseslint.config(
	{ ignores: ['src-tauri/', 'dist/', '.angular/'] },
	{
		files: ['src/**/*.ts', 'scripts/**/*.mjs', 'eslint.config.mjs'],
		extends: [tseslint.configs.base],
		plugins: { '@stylistic': stylistic },
		rules: {
			'@stylistic/padding-line-between-statements': [
				'error',
				{ blankLine: 'always', prev: '*', next: blocks },
				{ blankLine: 'always', prev: blocks, next: '*' },
				{ blankLine: 'always', prev: '*', next: ['return', 'throw'] },
			],
		},
	},
);
