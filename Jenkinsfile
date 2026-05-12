pipeline {
  agent any

  environment {
    IMAGE_NAME = 'trminh06/taskmanager'
    REPORTS    = 'reports'
    SONAR_TOKEN = credentials("sonarcloud-token")
  }

  options {
    timestamps()
    timeout(time: 30, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '20'))
    disableConcurrentBuilds()
  }

  stages {

    stage('Build') {
      steps {
        script {
          env.GIT_SHORT = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
          env.TAG       = "${BUILD_NUMBER}-${env.GIT_SHORT}"
          env.REL_TAG   = "v0.1.${BUILD_NUMBER}"
        }
        sh """
          docker build --target release -t ${IMAGE_NAME}:${env.TAG} -t ${IMAGE_NAME}:ci .
          docker build --target test    -t ${IMAGE_NAME}:test-${env.TAG} .
          mkdir -p ${REPORTS}
          echo "${IMAGE_NAME}:${env.TAG}" > ${REPORTS}/image-tag.txt
        """
        archiveArtifacts artifacts: "${REPORTS}/image-tag.txt", fingerprint: true
      }
    }

    stage('Test') {
      steps {
        sh "rm -rf ${REPORTS} coverage && mkdir -p ${REPORTS} coverage"
        sh """
          docker run --rm \\
            -v "\$PWD/${REPORTS}":/app/reports \\
            -v "\$PWD/coverage":/app/coverage \\
            ${IMAGE_NAME}:test-${env.TAG}
        """
      }
      post {
        always {
          junit allowEmptyResults: true, testResults: "${REPORTS}/junit.xml"
          archiveArtifacts artifacts: "coverage/lcov.info,coverage/cobertura-coverage.xml",
                           allowEmptyArchive: true
        }
      }
    }

    stage('Code Quality') {
      steps {
        withSonarQubeEnv('SonarCloud') {
          sh '''
            docker run --rm \
              -e SONAR_HOST_URL \
              -e SONAR_TOKEN \
              -v "$PWD":/usr/src \
              sonarsource/sonar-scanner-cli:latest
          '''
        }
        timeout(time: 5, unit: 'MINUTES') {
          waitForQualityGate abortPipeline: true
        }
      }
    }

    stage('Security') {
      parallel {
        stage('npm audit') {
          steps {
            sh """
              docker run --rm -v "\$PWD":/app -w /app node:22-alpine sh -c '
                npm ci --include=dev --no-fund --no-audit > /dev/null 2>&1
                npm audit --audit-level=high --json
              ' > ${REPORTS}/npm-audit.json || true
            """
            sh '''
              node -e "
                const fs = require('fs');
                const a = JSON.parse(fs.readFileSync('reports/npm-audit.json','utf8'));
                const m = (a.metadata && a.metadata.vulnerabilities) || {};
                console.log('Vulnerabilities:', JSON.stringify(m));
                const bad = (m.high || 0) + (m.critical || 0);
                if (bad > 0) { console.error('FAIL: HIGH/CRITICAL vulns present'); process.exit(1); }
              "
            '''
          }
          post {
            always {
              archiveArtifacts artifacts: "${REPORTS}/npm-audit.json", allowEmptyArchive: true
            }
          }
        }
        stage('Trivy image scan') {
          steps {
            sh """
              docker run --rm \\
                -v /var/run/docker.sock:/var/run/docker.sock \\
                -v "\$PWD/${REPORTS}":/reports \\
                aquasec/trivy:latest image \\
                --severity HIGH,CRITICAL --exit-code 1 --no-progress \\
                --format json --output /reports/trivy.json \\
                ${IMAGE_NAME}:${env.TAG}
            """
          }
          post {
            always {
              archiveArtifacts artifacts: "${REPORTS}/trivy.json", allowEmptyArchive: true
            }
          }
        }
      }
    }

    stage('Deploy: staging') {
      steps {
        script {
          env.PREV_TAG = sh(
            script: "docker inspect -f '{{.Config.Image}}' taskmanager-staging 2>/dev/null | awk -F: '{print \$NF}' || true",
            returnStdout: true
          ).trim()
          if (!env.PREV_TAG) env.PREV_TAG = env.TAG
        }
        sh """
          IMAGE_NAME=${IMAGE_NAME} IMAGE_TAG=${env.TAG} \\
            docker compose -f infra/docker-compose.staging.yml up -d --remove-orphans
          for i in 1 2 3 4 5 6; do
            curl -fsS http://localhost:3001/api/health && break || sleep 2
          done
          curl -fsS http://localhost:3001/api/health
        """
      }
      post {
        failure {
          sh """
            echo 'Rolling back staging to ${env.PREV_TAG}'
            IMAGE_NAME=${IMAGE_NAME} IMAGE_TAG=${env.PREV_TAG} \\
              docker compose -f infra/docker-compose.staging.yml up -d || true
          """
        }
      }
    }

    stage('Release') {
      when { branch 'main' }
      steps {
        withCredentials([usernamePassword(credentialsId: 'dockerhub-creds',
                                          usernameVariable: 'DH_USER',
                                          passwordVariable: 'DH_PASS')]) {
          sh """
            echo \$DH_PASS | docker login -u \$DH_USER --password-stdin
            docker buildx create --use --name multiarch 2>/dev/null || docker buildx use multiarch
            docker buildx inspect --bootstrap > /dev/null
            docker buildx build --target release --platform linux/amd64,linux/arm64 \\
              -t ${IMAGE_NAME}:${env.REL_TAG} \\
              -t ${IMAGE_NAME}:latest \\
              -t ${IMAGE_NAME}:${env.TAG} \\
              --push .
          """
        }
        sh """
          IMAGE_NAME=${IMAGE_NAME} IMAGE_TAG=${env.REL_TAG} \\
            docker compose -f infra/docker-compose.production.yml up -d --remove-orphans
          for i in 1 2 3 4 5 6; do
            curl -fsS http://localhost:3000/api/health && break || sleep 2
          done
          curl -fsS http://localhost:3000/api/health
        """
        withCredentials([usernamePassword(credentialsId: 'github-pat',
                                          usernameVariable: 'GH_USER',
                                          passwordVariable: 'GH_TOKEN')]) {
          sh """
            git config user.email "ci@taskmanager.local"
            git config user.name  "Jenkins CI"
            git tag -a ${env.REL_TAG} -m "Release ${env.REL_TAG} (build ${BUILD_NUMBER})" || true
            git push https://\$GH_USER:\$GH_TOKEN@github.com/Trminh06-work/TaskManager.git --tags || true
          """
        }
      }
    }

    stage('Monitoring') {
      steps {
        sh '''
          # 1. Production app exposes Prometheus metrics
          curl -fsS http://localhost:3000/metrics | grep -q http_request_duration_seconds
          # 2. Prometheus is healthy and scraping production
          curl -fsS http://localhost:9090/-/ready
          curl -fsS "http://localhost:9090/api/v1/targets?state=active" \
            | grep -E '"health":"up"' > /dev/null
          # 3. Generate some traffic so metrics are non-zero in dashboards
          for i in $(seq 1 20); do curl -s http://localhost:3000/api/health > /dev/null; done
          echo 'Monitoring verified: metrics exposed, Prometheus scraping up.'
        '''
      }
    }
  }

  post {
    always {
      sh 'docker image prune -f --filter "until=24h" || true'
    }
    success {
      echo "Pipeline OK. Image: ${IMAGE_NAME}:${env.TAG}  Release: ${IMAGE_NAME}:${env.REL_TAG}"
    }
    failure {
      echo "Pipeline FAILED at stage. See logs above."
    }
  }
}
