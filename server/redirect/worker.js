// Sends every visit to getnorthfix.com (and www) to the same path on northfix.app.
export default {
  fetch(request) {
    const url = new URL(request.url);
    return Response.redirect(`https://northfix.app${url.pathname}${url.search}`, 301);
  },
};
