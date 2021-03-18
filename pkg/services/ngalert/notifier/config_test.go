package notifier

import (
	"errors"
	"io/ioutil"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/stretchr/testify/assert"
)

func Test_PersistTemplates(t *testing.T) {
	tc := []struct {
		name            string
		templates       map[string]string
		expectedPaths   []string
		expectedError   error
		expcectedChange bool
	}{
		{
			name:            "With valid templates file names, it persists successfully",
			templates:       map[string]string{"email.template": "a perfectly fine template"},
			expcectedChange: true,
			expectedError:   nil,
			expectedPaths:   []string{"email.template"},
		},
		{
			name:          "With a invalid filename, it fails",
			templates:     map[string]string{"adirecotry/email.template": "a perfectly fine template"},
			expectedError: errors.New("template file name 'adirecotry/email.template' is  not valid"),
		},
	}

	for _, tt := range tc {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			c := &Config{Templates: tt.templates}

			paths, changed, persistErr := c.PersistTemplates(dir)

			files := map[string]string{}
			readFiles, err := ioutil.ReadDir(dir)
			require.NoError(t, err)
			for _, f := range readFiles {
				if f.IsDir() || f.Name() == "" {
					continue
				}
				content, err := ioutil.ReadFile(filepath.Join(dir, f.Name()))
				require.NoError(t, err)
				files[f.Name()] = string(content)
			}

			// Given we use a temporary directory in tests, we need to prepend the expected paths with it.
			for i, p := range tt.expectedPaths {
				tt.expectedPaths[i] = filepath.Join(dir, p)
			}

			if tt.expectedError != nil {
				require.Equal(t, tt.expectedError, persistErr)
				assert.Equal(t, tt.expectedPaths, paths)
				assert.Equal(t, tt.expcectedChange, changed)
			} else {
				assert.Equal(t, tt.expectedPaths, paths)
				assert.Equal(t, tt.templates, files)
				assert.Equal(t, tt.expcectedChange, changed)
				require.NoError(t, persistErr)
			}
		})
	}
}

func Test_parse(t *testing.T) {
	tc := []struct {
		name              string
		rawConfig         string
		rawTemplate       string
		expectedTemplates map[string]string
		expectedError     error
	}{
		{
			name: "with a valid config and template",
			rawConfig: `
global:
  smtp_from: noreply@grafana.net
route:
  receiver: email
receivers:
  - name: email
`,
			rawTemplate: `
template_files:
  'email.template': something with a pretty good content
`,
			expectedTemplates: map[string]string{"email.template": "something with a pretty good content"},
		},
		{
			name:          "with an empty configuration, it is not valid.",
			rawConfig:     "",
			expectedError: errors.New("unable to parse Alertmanager configuration: no route provided in config"),
		},
	}

	for _, tt := range tc {
		t.Run(tt.name, func(t *testing.T) {
			c, err := parse(tt.rawConfig, tt.rawTemplate)

			if tt.expectedError != nil {
				assert.Nil(t, c)
				assert.Equal(t, tt.expectedError.Error(), err.Error())
			} else {
				require.NoError(t, err)
				assert.NotNil(t, c.Alertmanager)
				assert.Equal(t, tt.expectedTemplates, c.Templates)
			}
		})
	}
}
