FROM node:20-slim

WORKDIR /app

# Copy package files and install
COPY package.json package-lock.json* ./
RUN npm install

# Copy the rest of the application
COPY . .

# Expose the development port
EXPOSE 5173

# Command to run the development server
CMD ["npm", "run", "dev", "--", "--host"]
