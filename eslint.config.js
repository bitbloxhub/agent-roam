import antfu from "@antfu/eslint-config"

export default antfu({
	stylistic: {
		indent: "tab",
		quotes: "double",
		overrides: {
			"style/brace-style": ["error", "1tbs", { allowSingleLine: true }],
		},
	},
	typescript: true,
	yaml: true,
	toml: false,
})
