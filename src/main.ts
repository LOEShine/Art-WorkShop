import { createApp } from "vue";
import { createPinia } from "pinia";

import App from "@/App.vue";
import { router } from "@/router";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/caveat/600.css";
import "@fontsource/caveat/700.css";
import "@/styles/reference.css";

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.mount("#app");
