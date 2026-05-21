module.exports = {
    parser: '@typescript-eslint/parser',
    parserOptions: {
        project: 'tsconfig.json',
        tsconfigRootDir: __dirname,
        sourceType: 'module',
    },
    plugins: ['prettier', '@typescript-eslint', 'import'],
    extends: ['prettier', 'plugin:@typescript-eslint/recommended', 'plugin:import/recommended'],
    root: true,
    env: {
        node: true,
        jest: true,
    },
    ignorePatterns: ['.eslintrc.js'],
    rules: {
        'prettier/prettier': 'off',
        'react-hooks/rules-of-hooks': 'off',
        'react/display-name': 'off',
        'import/export': 'off',
        'import/prefer-default-export': 'off',
        'import/no-named-as-default': 'off',
        'import/no-unresolved': 'error',

        '@typescript-eslint/no-unused-vars': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        'react-hooks/rules-of-hooks': 'off',

        'import/order': [
            'error',
            {
                groups: ['builtin', 'external', 'internal', ['sibling', 'parent'], 'index', 'unknown'],
                'newlines-between': 'always',
                alphabetize: {
                    order: 'asc',
                    caseInsensitive: true,
                },
            },
        ],
        'sort-imports': [
            'error',
            {
                ignoreCase: false,
                ignoreDeclarationSort: true,
                ignoreMemberSort: false,
                memberSyntaxSortOrder: ['none', 'all', 'multiple', 'single'],
                allowSeparatedGroups: true,
            },
        ],
    },
    settings: {
        'import/resolver': {
            typescript: {
                project: './tsconfig.json',
            },
        },
    },
}
