import { createRouter, createWebHistory } from "vue-router";

const HomeView = () => import("@/views/HomeView.vue");
const AdminView = () => import("@/views/AdminView.vue");

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
      redirect: "/",
    },
    {
      path: "/admin",
      name: "admin",
      component: AdminView,
    },
  ],
});
