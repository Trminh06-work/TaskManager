pipeline {
  agent any

  environment {
    IMAGE_NAME = 'trminh06/taskmanager'
    REPORTS    = 'reports'
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
        script {
          docker.image("${IMAGE_NAME}:test-${env.TAG}").inside('-u root --entrypoint=""') {
            sh '''
              cd /app
              DB_PATH=:memory: NODE_ENV=test npm run test:coverage
              cp -r /app/reports/. "${WORKSPACE}/reports/" 2>/dev/null || true
              cp -r /app/coverage/. "${WORKSPACE}/coverage/" 2>/dev/null || true
            '''
          }
        }
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
          script {
            docker.image('sonarsource/sonar-scanner-cli:latest').inside('-u root --entrypoint=""') {
              sh 'sonar-scanner -Dsonar.host.url=$SONAR_HOST_URL -Dsonar.token=$SONAR_AUTH_TOKEN'
            }
          }
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
            script {
              docker.image('node:22-alpine').inside('-u root') {
                sh """
                  npm ci --include=dev --no-fund --no-audit > /dev/null 2>&1
                  npm audit --audit-level=high --json > ${REPORTS}/npm-audit.json || true
                  node -e "
                    const fs = require('fs');
                    const a = JSON.parse(fs.readFileSync('${REPORTS}/npm-audit.json','utf8'));
                    const m = (a.metadata && a.metadata.vulnerabilities) || {};
                    console.log('Vulnerabilities:', JSON.stringify(m));
                    const bad = (m.high || 0) + (m.critical || 0);
                    if (bad > 0) { console.error('FAIL: HIGH/CRITICAL vulns present'); process.exit(1); }
                  "
                """
              }
            }
          }
          post {
            always {
              archiveArtifacts artifacts: "${REPORTS}/npm-audit.json", allowEmptyArchive: true
            }
          }
        }
        stage('Trivy image scan') {
          steps {
            // No workspace mount needed: trivy talks to the docker daemon via the socket
            // and we capture its JSON output via shell redirect inside the Jenkins container.
            //
            // Flags:
            //   --ignore-unfixed   skip CVEs with no upstream fix (most base-image noise)
            //   --scanners vuln    skip secret scanning (we don't ship secrets in the image)
            //   --severity         only HIGH and CRITICAL gate the build
            sh """
              set +e
              docker run --rm \\
                -v /var/run/docker.sock:/var/run/docker.sock \\
                aquasec/trivy:latest image \\
                --severity HIGH,CRITICAL \\
                --ignore-unfixed \\
                --scanners vuln \\
                --exit-code 1 --no-progress \\
                --format json \\
                ${IMAGE_NAME}:${env.TAG} > ${REPORTS}/trivy.json
              rc=\$?
              set -e
              if [ \$rc -ne 0 ]; then
                echo '--- Trivy found fixable HIGH/CRITICAL CVEs ---'
                docker run --rm \\
                  -v /var/run/docker.sock:/var/run/docker.sock \\
                  aquasec/trivy:latest image \\
                  --severity HIGH,CRITICAL --ignore-unfixed --scanners vuln \\
                  --no-progress --format table \\
                  ${IMAGE_NAME}:${env.TAG} || true
                exit 1
              fi
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
            docker compose -p taskmanager-staging \\
              -f infra/docker-compose.staging.yml up -d --remove-orphans
          for i in 1 2 3 4 5 6 7 8; do
            if docker exec taskmanager-staging wget -qO- http://localhost:3000/api/health; then
              break
            fi
            echo "attempt \$i: not ready"
            sleep 2
          done
          docker exec taskmanager-staging wget -qO- http://localhost:3000/api/health
        """
      }
      post {
        failure {
          sh """
            echo 'Rolling back staging to ${env.PREV_TAG}'
            IMAGE_NAME=${IMAGE_NAME} IMAGE_TAG=${env.PREV_TAG} \\
              docker compose -p taskmanager-staging \\
                -f infra/docker-compose.staging.yml up -d || true
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
            docker compose -p taskmanager-production \\
              -f infra/docker-compose.production.yml up -d --remove-orphans
          for i in 1 2 3 4 5 6 7 8; do
            if docker exec taskmanager-production wget -qO- http://localhost:3000/api/health; then
              break
            fi
            echo "attempt \$i: not ready"
            sleep 2
          done
          docker exec taskmanager-production wget -qO- http://localhost:3000/api/health
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
          # 1. Production app exposes Prometheus metrics (checked from inside the app container)
          docker exec taskmanager-production wget -qO- http://localhost:3000/metrics \
            | grep -q http_request_duration_seconds
          # 2. Prometheus is healthy and is scraping production (checked from inside prometheus container)
          docker exec prometheus wget -qO- http://localhost:9090/-/ready
          docker exec prometheus wget -qO- "http://localhost:9090/api/v1/targets?state=active" \
            | grep -E '"health":"up"' > /dev/null
          # 3. Generate some traffic so metrics are non-zero in dashboards
          for i in $(seq 1 20); do
            docker exec taskmanager-production wget -qO- http://localhost:3000/api/health > /dev/null || true
          done
          echo "Monitoring verified: metrics exposed, Prometheus scraping up."
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
