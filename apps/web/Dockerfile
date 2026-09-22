# Frontend image optional for compose; prefer `npm run dev:web` locally.
FROM nginx:alpine
COPY dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
