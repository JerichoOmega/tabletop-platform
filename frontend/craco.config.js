module.exports = {
  style: {
    postcss: {
      mode: "extends",
      loaderOptions: (postcssLoaderOptions) => {
        postcssLoaderOptions.postcssOptions = postcssLoaderOptions.postcssOptions || {};
        postcssLoaderOptions.postcssOptions.plugins = [
          require("tailwindcss"),
          require("autoprefixer"),
        ];
        return postcssLoaderOptions;
      },
    },
  },
};
