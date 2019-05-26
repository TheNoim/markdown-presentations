<template>
  <section class="hero h100">
    <div class="hero-body">
      <div class="container">
        <h1 class="title">Presentation</h1>
        <div class="columns is-multiple">
          <div class="column is-4" v-for="(presentation, index) in presentations" :key="index">
            <div class="card bm--card-equal-height">
              <div class="card-image" v-if="presentation.thumbnail">
                <figure class="image is-4by3">
                  <img :src="presentation.thumbnail" alt="Presentation Thumbnail">
                </figure>
              </div>
              <div class="card-content">
                <div class="media">
                  <div class="media-content">
                    <p class="title is-4" v-html="presentation.title"></p>
                    <p class="subtitle is-6">
                      {{presentation.authors.length > 2 ? 'Author: ' : 'Authors:' }}
                      <span
                        v-html="internationalList(presentation.authors)"
                      ></span>
                    </p>
                  </div>
                </div>
                <div class="content">
                  <span v-html="presentation.description"></span>
                  <br>
                  <time
                    :datetime="presentation.date"
                    v-html="internationalDateFormat(presentation.date)"
                  ></time>
                </div>
                <footer class="card-footer">
                  <a :href="presentationPath(presentation.path)" class="card-footer-item">Open</a>
                </footer>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script>
import { data } from './data';

const formatter = new Intl.ListFormat('en', {
    style: 'short',
    type: 'disjunction'
});

const dateFormatter = new Intl.DateTimeFormat('en-GB');

export default {
    name: 'app',
    data: () => ({
        presentationsRaw: data
    }),
    computed: {
        presentations() {
            return this.presentationsRaw.sort((a, b) => {
                const aDate = new Date(a.date);
                const bDate = new Date(b.date);
                return bDate - aDate;
            });
        }
    },
    methods: {
        internationalList(array = []) {
            return formatter.format(array);
        },
        internationalDateFormat(dateString) {
            const date = new Date(dateString);
            return dateFormatter.format(date);
        },
        presentationPath(path) {
            return `/${path}`;
        }
    }
};
</script>

<style scoped>
.h100 {
    height: 100vh;
}
.bm--card-equal-height {
    display: flex;
    flex-direction: column;
    height: 100%;
}
.bm--card-equal-height .card-footer {
    margin-top: auto;
}
</style>

