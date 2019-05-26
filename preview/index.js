import Vue from 'vue';
import App from './app.vue';
import Buefy from 'buefy';
import 'buefy/dist/buefy.css';

Vue.use(Buefy);

new Vue(App).$mount('#app');
