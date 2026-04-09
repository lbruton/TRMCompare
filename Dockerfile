FROM nginx:alpine

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Copy static site
COPY index.html /usr/share/nginx/html/
COPY favicon.svg /usr/share/nginx/html/
COPY css/ /usr/share/nginx/html/css/
COPY js/ /usr/share/nginx/html/js/
COPY libs/ /usr/share/nginx/html/libs/
COPY about/ /usr/share/nginx/html/about/
COPY install/ /usr/share/nginx/html/install/

# OpenShift compatibility: arbitrary UID support
# nginx:alpine runs as nginx (101) by default, but OpenShift assigns random UIDs.
# Ensure all required paths are group-writable for root group (GID 0).
RUN chgrp -R 0 /usr/share/nginx/html /var/cache/nginx /var/log/nginx /tmp && \
    chmod -R g=u /usr/share/nginx/html /var/cache/nginx /var/log/nginx /tmp

EXPOSE 8080

USER 1001

CMD ["nginx", "-g", "daemon off;"]
