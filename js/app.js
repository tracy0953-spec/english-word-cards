(function () {
  const { createApp, ref, computed, nextTick } = Vue;

  const TAG_GROUPS = [
    {
      name: "频率",
      color: "#ee0a24",
      tags: ["高频", "中频", "低频"]
    },
    {
      name: "风格",
      color: "#07c160",
      tags: ["偏口语", "通用", "偏书面", "正式", "学术"]
    },
    {
      name: "表达功能",
      color: "#1989fa",
      tags: ["日常动作", "情绪感受", "态度立场", "观点评价", "人际交流", "描述人物", "描述事物", "空间位置", "时间顺序", "数量程度", "变化趋势"]
    },
    {
      name: "逻辑关系",
      color: "#7232dd",
      tags: ["因果", "对比", "转折", "递进", "条件", "让步", "举例", "总结", "强调", "顺序"]
    },
    {
      name: "场景主题",
      color: "#ff976a",
      tags: ["生活", "家庭", "工作", "教育", "科技", "AI", "商业", "经济", "环境", "社会", "新闻", "医疗健康", "自然生物", "交通旅行", "文化艺术"]
    },
    {
      name: "雅思用途",
      color: "#0fa5a5",
      tags: ["雅思口语", "雅思写作", "雅思阅读", "雅思听力"]
    },
    {
      name: "语言特征",
      color: "#b88230",
      tags: ["固定搭配", "常见介词", "一词多义", "易混词", "词性变化", "短语动词", "习语", "搭配词"]
    }
  ];

  const TAG_COLOR_MAP = {};
  TAG_GROUPS.forEach(function (g) {
    g.tags.forEach(function (t) {
      TAG_COLOR_MAP[t] = g.color;
    });
  });

  createApp({
    setup: function () {
      const words = ref((window.WORD_DATA && window.WORD_DATA.words) || []);
      const search = ref("");
      const selectedTags = ref([]);
      const showPicker = ref(false);
      const tempSelected = ref([]);
      let currentAudio = null;

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
          if (window.vant && vant.showToast) {
            vant.showToast("发音播放失败，请检查网络");
          }
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
        TAG_GROUPS: TAG_GROUPS,
        words: words,
        search: search,
        selectedTags: selectedTags,
        showPicker: showPicker,
        tempSelected: tempSelected,
        filtered: filtered,
        tagColor: tagColor,
        derivList: derivList,
        familyName: familyName,
        toggleTag: toggleTag,
        removeTag: removeTag,
        clearTags: clearTags,
        openPicker: openPicker,
        resetPicker: resetPicker,
        confirmPicker: confirmPicker,
        play: play,
        highlight: highlight,
        jumpTo: jumpTo
      };
    }
  }).use(vant).mount("#app");
})();
