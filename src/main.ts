import { createApp } from "vue";
import { createPinia } from "pinia";

import App from "@/App.vue";
import { router } from "@/router";
import { useAppStore } from "@/stores/app";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/caveat/600.css";
import "@fontsource/caveat/700.css";
import "@/styles/reference.css";
import "@/styles/app.css";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);

const store = useAppStore(pinia);
void store.hydrateHistory();

app.mount("#app");
