const menu = document.querySelector('.menu-btn');
const nav = document.querySelector('.nav-links');

if (menu && nav) {
  menu.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menu.setAttribute('aria-expanded', open);
  });
}

document.querySelectorAll('.nav-links a').forEach(a => {
  a.addEventListener('click', () => {
    if (nav) nav.classList.remove('open');
  });
});


/* =========================================
   Language
========================================= */

const LANGUAGE_KEY = 'maxgain-language';

function getSavedLanguage() {
  const saved = localStorage.getItem(LANGUAGE_KEY);

  return saved === 'en' ? 'en' : 'ko';
}

function applyLanguage(lang) {
  const language = lang === 'en' ? 'en' : 'ko';

  document.documentElement.lang = language;

  /*
   * 일반 텍스트
   */
  document
    .querySelectorAll('[data-ko][data-en]')
    .forEach(element => {
      element.textContent =
        language === 'en'
          ? element.dataset.en
          : element.dataset.ko;
    });

  /*
   * input placeholder
   */
  document
    .querySelectorAll(
      '[data-placeholder-ko][data-placeholder-en]'
    )
    .forEach(element => {
      element.placeholder =
        language === 'en'
          ? element.dataset.placeholderEn
          : element.dataset.placeholderKo;
    });

  /*
   * KO / EN 버튼 상태
   */
  document
    .querySelectorAll('[data-lang]')
    .forEach(button => {
      const active =
        button.dataset.lang === language;

      button.classList.toggle('active', active);

      button.setAttribute(
        'aria-pressed',
        active ? 'true' : 'false'
      );
    });

  /*
   * 선택 언어 저장
   */
  localStorage.setItem(
    LANGUAGE_KEY,
    language
  );

  /*
   * Product Search / Resources 등
   * 동적으로 생성되는 영역에 알림
   */
  window.dispatchEvent(
    new CustomEvent(
      'maxgain:languagechange',
      {
        detail: {
          language
        }
      }
    )
  );
}


/*
 * KO / EN 클릭
 */
document
  .querySelectorAll('[data-lang]')
  .forEach(button => {
    button.addEventListener(
      'click',
      () => {
        applyLanguage(
          button.dataset.lang
        );
      }
    );
  });


/*
 * 페이지를 열 때 이전 언어 복원
 */
applyLanguage(
  getSavedLanguage()
);


/*
 * 다른 JS에서도 현재 언어 확인 가능
 */
window.MAXGAIN_LANGUAGE = {
  apply: applyLanguage,

  current() {
    return getSavedLanguage();
  }
};


/* =========================================
   Mail form fallback
========================================= */

document
  .querySelectorAll('.mail-form')
  .forEach(form => {
    form.addEventListener(
      'submit',
      e => {
        e.preventDefault();

        const f =
          new FormData(form);

        const subject =
          `MAXGAIN Inquiry - ${
            f.get('part') ||
            f.get('subject') ||
            'Website'
          }`;

        let body = '';

        for (const [k, v] of f.entries()) {
          body += `${k}: ${v}\n`;
        }

        location.href =
          `mailto:sales@maxgain.co.kr` +
          `?subject=${encodeURIComponent(subject)}` +
          `&body=${encodeURIComponent(body)}`;
      }
    );
  });