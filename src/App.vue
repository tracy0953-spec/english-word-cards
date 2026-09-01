<template>
  <div class="page">
    <header class="hero">
      <div class="hero-title">Word Cards</div>
      <div class="hero-sub">每日单词 · 美音发音 · 标签筛选</div>
    </header>

    <div class="toolbar">
      <van-search
        v-model="search"
        class="word-search"
        shape="round"
        placeholder="搜索单词，如 app"
        clearable
      ></van-search>
      <div class="filter-bar">
        <button class="filter-btn" @click="openPicker">
          <van-icon name="filter-o"></van-icon>
          <span>标签筛选</span>
          <em v-if="selectedTags.length" class="filter-badge">{{ selectedTags.length }}</em>
        </button>
        <div class="active-chips" v-if="selectedTags.length">
          <span
            v-for="t in selectedTags"
            :key="t"
            class="filter-chip"
            :style="{ background: tagColor(t) }"
            @click="removeTag(t)"
          >{{ t }}<van-icon name="cross" class="filter-chip-x"></van-icon></span>
          <span class="clear-all" @click="clearTags">清空</span>
        </div>
      </div>
    </div>

    <main class="card-list">
      <div v-if="loading" class="state-box">
        <van-loading size="28px" color="#6366f1">加载单词中…</van-loading>
      </div>
      <van-empty v-else-if="loadError" :description="loadError"></van-empty>

      <template v-else>
        <article v-for="w in filtered" :id="'word-' + w.id" :key="w.id" class="word-card">
          <div class="word-head">
            <div class="word-line">
              <span class="word-text">{{ w.word }}</span>
              <span class="word-pos" v-if="w.pos">{{ w.pos }}</span>
              <button class="speak-btn" @click="play(w.word)" :aria-label="'play ' + w.word">
                <van-icon name="volume-o"></van-icon>
              </button>
            </div>
            <div class="phonetic" v-if="w.phonetic">{{ w.phonetic }}</div>
          </div>

          <div class="tag-row">
            <van-tag
              v-for="t in w.tags"
              :key="t"
              round
              size="medium"
              :plain="!selectedTags.includes(t)"
              :color="tagColor(t)"
              class="word-tag"
              @click="toggleTag(t)"
            >{{ t }}</van-tag>
          </div>

          <div class="meaning">{{ w.meaning }}</div>

          <div class="examples" v-if="w.examples && w.examples.length">
            <div v-for="(ex, i) in w.examples" :key="i" class="example">
              <div class="example-en" v-html="highlight(ex.en, w.word)"></div>
              <div class="example-zh">{{ ex.zh }}</div>
            </div>
          </div>

          <div class="derivatives" v-if="derivList(w).length">
            <div class="deriv-title"><van-icon name="cluster-o"></van-icon> 同根词族 · {{ familyName(w) }}</div>
            <div
              v-for="(d, i) in derivList(w)"
              :key="i"
              class="deriv-item"
              :class="{ clickable: !!d.ref }"
              @click="jumpTo(d)"
            >
              <span class="deriv-word">{{ d.word }}</span>
              <span class="deriv-morph" v-if="d.morph">{{ d.morph }}</span>
              <span class="deriv-phonetic" v-if="d.phonetic">{{ d.phonetic }}</span>
              <span class="deriv-meaning">{{ d.meaning }}</span>
              <van-icon v-if="d.ref" name="arrow" class="deriv-arrow"></van-icon>
            </div>
          </div>
        </article>

        <van-empty v-if="filtered.length === 0" description="没有匹配的单词"></van-empty>

        <footer class="list-footer">
          共 {{ filtered.length }} / {{ words.length }} 个单词
        </footer>
      </template>
    </main>
  </div>

  <van-popup v-model:show="showPicker" position="bottom" round :style="{ height: '72%' }">
    <div class="picker">
      <div class="picker-header">
        <span class="picker-reset" @click="resetPicker">重置</span>
        <span class="picker-title">标签筛选</span>
        <span class="picker-done" @click="confirmPicker">确定</span>
      </div>
      <div class="picker-body">
        <div v-for="g in TAG_GROUPS" :key="g.name" class="picker-group">
          <div class="picker-group-name">{{ g.name }}</div>
          <van-checkbox-group v-model="tempSelected" shape="square" class="picker-checks">
            <van-checkbox
              v-for="t in g.tags"
              :key="t"
              :name="t"
              checked-color="#6366f1"
              icon-size="16px"
              class="picker-check"
            >{{ t }}</van-checkbox>
          </van-checkbox-group>
        </div>
      </div>
    </div>
  </van-popup>
</template>

<script>
import { ref, computed, onMounted, nextTick } from "vue";
import { showToast } from "vant";
import { TAG_GROUPS, TAG_COLOR_MAP } from "./tags";

const API_BASE = import.meta.env.BASE_URL || "/";

export default {
  setup() {
    const words = ref([]);
    const search = ref("");
    const selectedTags = ref([]);
    const showPicker = ref(false);
    const tempSelected = ref([]);
    const loading = ref(true);
    const loadError = ref("");
    let currentAudio = null;

    onMounted(async () => {
      try {
        const res = await fetch(API_BASE + "api/words");
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        words.value = data.words || [];
      } catch (e) {
        loadError.value = "单词数据加载失败，请稍后重试";
      } finally {
        loading.value = false;
      }
    });

    const filtered = computed(function () {
      const q = search.value.trim().toLowerCase();
      const qRaw = search.value.trim();
      const list = words.value.filter(function (w) {
        const matchQuery =
          !q ||
          w.word.toLowerCase().includes(q) ||
          (w.meaning || "").indexOf(qRaw) !== -1;
        const matchTags = selectedTags.value.every(function (t) {
          return w.tags.indexOf(t) !== -1;
        });
        return matchQuery && matchTags;
      });
      if (q) {
        list.sort(function (a, b) {
          const aw = a.word.toLowerCase();
          const bw = b.word.toLowerCase();
          const ap = aw.startsWith(q) ? 0 : 1;
          const bp = bw.startsWith(q) ? 0 : 1;
          if (ap !== bp) return ap - bp;
          return aw < bw ? -1 : aw > bw ? 1 : 0;
        });
      }
      return list;
    });

    function tagColor(t) {
      return TAG_COLOR_MAP[t] || "#969799";
    }

    function normWord(s) {
      return String(s || "").trim().toLowerCase().replace(/\s+/g, "-");
    }

    function shortMorph(morph) {
      if (!morph) return "";
      return morph.split(/\s+/)[0];
    }

    function familyName(w) {
      const head = words.value.find(function (x) {
        return x.id === (w.family || w.id);
      });
      return head ? head.word : w.family || w.word;
    }

    function derivList(w) {
      const fam = w.family || w.id;
      const members = words.value
        .filter(function (x) {
          return x !== w && (x.family || x.id) === fam;
        })
        .map(function (x) {
          const firstMeaning = (x.meaning || "").split("；")[0];
          return {
            word: x.word,
            phonetic: x.phonetic || "",
            meaning: (x.pos ? x.pos + " " : "") + firstMeaning,
            ref: x.id,
            morph: shortMorph(x.morph)
          };
        })
        .sort(function (a, b) {
          return a.word.localeCompare(b.word);
        });
      const inline = (w.derivatives || [])
        .filter(function (d) {
          return !words.value.some(function (x) {
            return normWord(x.word) === normWord(d.word);
          });
        })
        .map(function (d) {
          return {
            word: d.word,
            phonetic: d.phonetic || "",
            meaning: d.meaning,
            ref: d.ref || "",
            morph: ""
          };
        });
      return members.concat(inline);
    }

    function toggleTag(t) {
      const i = selectedTags.value.indexOf(t);
      if (i >= 0) selectedTags.value.splice(i, 1);
      else selectedTags.value.push(t);
    }

    function removeTag(t) {
      const i = selectedTags.value.indexOf(t);
      if (i >= 0) selectedTags.value.splice(i, 1);
    }

    function clearTags() {
      selectedTags.value = [];
    }

    function openPicker() {
      tempSelected.value = selectedTags.value.slice();
      showPicker.value = true;
    }

    function resetPicker() {
      tempSelected.value = [];
    }

    function confirmPicker() {
      selectedTags.value = tempSelected.value.slice();
      showPicker.value = false;
    }

    function play(word) {
      try {
        if (currentAudio) {
          currentAudio.pause();
          currentAudio = null;
        }
      } catch (e) {}
      const url =
        "https://dict.youdao.com/dictvoice?audio=" +
        encodeURIComponent(word) +
        "&type=2";
      currentAudio = new Audio(url);
      currentAudio.play().catch(function () {
        showToast("发音播放失败，请检查网络");
      });
    }

    function escapeRegExp(s) {
      return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function escapeHtml(s) {
      return s.replace(/[&<>"]/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
      });
    }

    function highlight(sentence, word) {
      if (!sentence) return "";
      const phrase = word.trim();
      const stem = phrase.split(/\s+/)[0];
      const re = new RegExp(
        "(" + escapeRegExp(phrase) + "|" + escapeRegExp(stem) + ")[a-zA-Z]*",
        "gi"
      );
      return escapeHtml(sentence).replace(re, "<mark>$&</mark>");
    }

    function jumpTo(d) {
      if (!d.ref) return;
      const target = words.value.find(function (w) {
        return w.id === d.ref;
      });
      if (!target) return;
      search.value = d.word;
      selectedTags.value = [];
      nextTick(function () {
        const el = document.getElementById("word-" + d.ref);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }

    return {
      TAG_GROUPS,
      words,
      search,
      selectedTags,
      showPicker,
      tempSelected,
      loading,
      loadError,
      filtered,
      tagColor,
      derivList,
      familyName,
      toggleTag,
      removeTag,
      clearTags,
      openPicker,
      resetPicker,
      confirmPicker,
      play,
      highlight,
      jumpTo
    };
  }
};
</script>
