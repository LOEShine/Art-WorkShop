import { createRouter, createWebHistory } from "vue-router";

const HomeView = () => import("@/views/HomeView.vue");
const PromptsView = () => import("@/views/PromptsView.vue");

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "home",
      component: HomeView,
    },
    {
      path: "/prompts",
      name: "prompts",
      component: PromptsView,
    },
  ],
});

