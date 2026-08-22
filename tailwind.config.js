/* Tailwind wird jetzt gebaut statt vom CDN geladen. Die CDN-Fassung weist
   selbst darauf hin, dass sie nicht fuer den produktiven Einsatz gedacht ist,
   und sie gab bei jedem Aufruf die Besucher-IP an einen Dritten. */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: { extend: {} },
  plugins: [],
}
